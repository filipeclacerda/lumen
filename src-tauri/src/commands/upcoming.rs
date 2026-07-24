use chrono::{Datelike, Local, NaiveDate};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::State;

use crate::{application::state::AppState, error::AppError};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingItem {
    date: String,
    label: String,
    amount_in_cents: i64,
    kind: String,
}

/// Adds `delta` months to a "YYYY-MM" value, wrapping across year boundaries. Mirrors
/// `commands::recurring::shift_month`, kept private here to avoid coupling to that module.
fn shift_month(value: &str, delta: i32) -> Result<String, AppError> {
    let date = NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Período mensal inválido".into()))?;
    let index = date.year() * 12 + date.month() as i32 - 1 + delta;
    Ok(format!(
        "{:04}-{:02}",
        index.div_euclid(12),
        index.rem_euclid(12) + 1
    ))
}

/// Number of days in a "YYYY-MM" month.
fn days_in_month(value: &str) -> Result<u32, AppError> {
    let next = shift_month(value, 1)?;
    let date = NaiveDate::parse_from_str(&format!("{next}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Período mensal inválido".into()))?;
    Ok(date.pred_opt().unwrap().day())
}

/// Returns items due in the next `days` days: open credit-card invoices and active recurring
/// transactions that have not been generated for their occurrence yet, sorted by date.
#[tauri::command]
pub async fn upcoming_items(
    days: i64,
    state: State<'_, AppState>,
) -> Result<Vec<UpcomingItem>, AppError> {
    upcoming_items_impl(days, &state.db).await
}

async fn upcoming_items_impl(days: i64, db: &SqlitePool) -> Result<Vec<UpcomingItem>, AppError> {
    let days = days.clamp(1, 60);
    let today = Local::now().date_naive();
    let end_date = today + chrono::Duration::days(days);
    let today_str = today.format("%Y-%m-%d").to_string();
    let end_str = end_date.format("%Y-%m-%d").to_string();

    let mut items = Vec::new();

    // (a) Open credit-card invoices due within the window.
    let invoice_rows = sqlx::query(
        "SELECT i.due_date, a.name account_name, i.total_cents
         FROM credit_card_invoices i JOIN accounts a ON a.id = i.account_id
         WHERE i.deleted_at IS NULL AND i.status = 'open'
         AND i.due_date BETWEEN ? AND ?",
    )
    .bind(&today_str)
    .bind(&end_str)
    .fetch_all(db)
    .await?;
    for row in invoice_rows {
        let account_name: String = row.get("account_name");
        items.push(UpcomingItem {
            date: row.get("due_date"),
            label: format!("Fatura {account_name}"),
            amount_in_cents: row.get("total_cents"),
            kind: "invoice".into(),
        });
    }

    // (b) Future installments use their persisted transaction date; no invoice dates are inferred.
    let installment_rows = sqlx::query(
        "SELECT t.date,t.description,t.amount_cents
         FROM transaction_installments i
         JOIN transactions t ON t.id=i.transaction_id
         WHERE t.deleted_at IS NULL AND t.date BETWEEN ? AND ?",
    )
    .bind(&today_str)
    .bind(&end_str)
    .fetch_all(db)
    .await?;
    for row in installment_rows {
        items.push(UpcomingItem {
            date: row.get("date"),
            label: row.get("description"),
            amount_in_cents: row.get("amount_cents"),
            kind: "installment".into(),
        });
    }

    // (c) Active recurring transactions with a pending (not-yet-generated) occurrence in the
    // window. `sync_recurring_transactions` (see commands/recurring.rs) generates occurrences up
    // to and including the current month once the configured day has arrived, so "pending" means:
    // any month after `last_generated_month` (or from `start_month` if never generated), bounded by
    // `end_month`, whose effective day falls inside [today, today+days].
    let current_month = today.format("%Y-%m").to_string();
    let last_relevant_month = end_date.format("%Y-%m").to_string();
    let recurring_rows = sqlx::query(
        "SELECT description, amount_cents, day_of_month, start_month, end_month, last_generated_month
         FROM recurring_transactions
         WHERE active = 1 AND deleted_at IS NULL AND start_month <= ?",
    )
    .bind(&last_relevant_month)
    .fetch_all(db)
    .await?;
    for row in recurring_rows {
        let description: String = row.get("description");
        let amount_in_cents: i64 = row.get("amount_cents");
        let day_of_month: i64 = row.get("day_of_month");
        let start_month: String = row.get("start_month");
        let end_month: Option<String> = row.get("end_month");
        let last_generated_month: Option<String> = row.get("last_generated_month");

        let first_pending = match &last_generated_month {
            Some(month) => shift_month(month, 1)?,
            None => start_month.clone(),
        };
        if first_pending > last_relevant_month {
            continue;
        }
        let last_pending = end_month
            .clone()
            .filter(|end| *end < last_relevant_month)
            .unwrap_or_else(|| last_relevant_month.clone());
        if first_pending > last_pending {
            continue;
        }

        let mut cursor = first_pending;
        while cursor <= last_pending {
            let effective_day = (day_of_month as u32).min(days_in_month(&cursor)?);
            let date = format!("{cursor}-{:02}", effective_day);
            // Skip the current month if the day hasn't arrived yet in the DB's eyes — actually we
            // want the opposite of `sync`: only *future* (or today's) occurrences belong here.
            if date.as_str() >= today_str.as_str() && date.as_str() <= end_str.as_str() {
                items.push(UpcomingItem {
                    date: date.clone(),
                    label: description.clone(),
                    amount_in_cents,
                    kind: "recurring".into(),
                });
            }
            if cursor == current_month {
                // Nothing pending before today in the current month is still "upcoming"; older
                // backlogged months are surfaced too (rare — only if sync hasn't run recently).
            }
            cursor = shift_month(&cursor, 1)?;
        }
    }

    items.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{complete_onboarding_impl, OnboardingInput};
    use uuid::Uuid;

    async fn setup() -> (tempfile::TempDir, SqlitePool, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("upcoming.db"))
            .await
            .unwrap();
        let onboarding = OnboardingInput {
            display_name: "Pessoa Teste".into(),
            monthly_target_in_cents: None,
            financial_goal: "organize".into(),
            onboarding_start_mode: "manual".into(),
        };
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;
        (directory, db, account_id)
    }

    async fn insert_invoice(
        db: &SqlitePool,
        account_id: &str,
        due_date: &str,
        status: &str,
        total_cents: i64,
    ) {
        let batch_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at) VALUES(?,?,datetime('now'))",
        )
        .bind(&batch_id)
        .bind("fatura.csv")
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoices(id,account_id,due_date,purchases_cents,credits_cents,total_cents,status,import_batch_id)
             VALUES(?,?,?,?,0,?,?,?)"
        ).bind(Uuid::new_v4().to_string()).bind(account_id).bind(due_date).bind(total_cents)
            .bind(total_cents).bind(status).bind(&batch_id).execute(db).await.unwrap();
    }

    #[tokio::test]
    async fn includes_open_invoice_due_in_window_and_excludes_out_of_window_or_paid() {
        let (_directory, db, account_id) = setup().await;
        let today = Local::now().date_naive();
        let in_window = (today + chrono::Duration::days(5))
            .format("%Y-%m-%d")
            .to_string();
        let out_of_window = (today + chrono::Duration::days(40))
            .format("%Y-%m-%d")
            .to_string();
        let paid_in_window = (today + chrono::Duration::days(3))
            .format("%Y-%m-%d")
            .to_string();

        insert_invoice(&db, &account_id, &in_window, "open", 25000).await;
        insert_invoice(&db, &account_id, &out_of_window, "open", 99999).await;
        insert_invoice(&db, &account_id, &paid_in_window, "paid", 11111).await;

        let items = upcoming_items_impl(15, &db).await.unwrap();
        let invoices: Vec<_> = items.iter().filter(|i| i.kind == "invoice").collect();
        assert_eq!(invoices.len(), 1);
        assert_eq!(invoices[0].date, in_window);
        assert_eq!(invoices[0].amount_in_cents, 25000);
    }

    #[tokio::test]
    async fn includes_pending_recurring_occurrence_in_window() {
        let (_directory, db, account_id) = setup().await;
        let today = Local::now().date_naive();
        let target_day = ((today.day() as i64) % 28) + 1; // always a valid day, distinct-ish from today
        sqlx::query(
            "INSERT INTO recurring_transactions(id,account_id,description,amount_cents,day_of_month,start_month,active)
             VALUES('r1',?,'Assinatura',?,?,?,1)",
        )
        .bind(&account_id)
        .bind(-2990i64)
        .bind(target_day)
        .bind(today.format("%Y-%m").to_string())
        .execute(&db)
        .await
        .unwrap();

        let items = upcoming_items_impl(60, &db).await.unwrap();
        let recurring: Vec<_> = items.iter().filter(|i| i.kind == "recurring").collect();
        assert!(
            recurring
                .iter()
                .any(|i| i.label == "Assinatura" && i.amount_in_cents == -2990),
            "expected a pending recurring occurrence, got {recurring:?}"
        );
    }

    #[tokio::test]
    async fn includes_future_installment_using_its_persisted_date() {
        let (_directory, db, account_id) = setup().await;
        let date = (Local::now().date_naive() + chrono::Duration::days(5))
            .format("%Y-%m-%d")
            .to_string();
        sqlx::query(
            "INSERT INTO installment_plans(id,account_id,first_date,description,total_cents,installment_count)
             VALUES('plan',? ,?,'Notebook',20000,2)",
        )
        .bind(&account_id)
        .bind(&date)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint)
             VALUES('installment',? ,?,'Notebook (1/2)','NOTEBOOK 1 2',-10000,'installment-fp')",
        )
        .bind(account_id)
        .bind(&date)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_installments(plan_id,transaction_id,installment_number,installment_count)
             VALUES('plan','installment',1,2)",
        )
        .execute(&db)
        .await
        .unwrap();

        let items = upcoming_items_impl(10, &db).await.unwrap();
        let installment = items
            .iter()
            .find(|item| item.kind == "installment")
            .unwrap();
        assert_eq!(installment.date, date);
        assert_eq!(installment.amount_in_cents, -10_000);
    }
}
