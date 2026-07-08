use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::{application::state::AppState, error::AppError};

use super::{ensure_account_active, ensure_category_active, manual_fingerprint};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringTransactionInput {
    id: Option<String>,
    account_id: String,
    category_id: Option<String>,
    description: String,
    amount_in_cents: i64,
    day_of_month: i64,
    start_month: String,
    end_month: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringTransaction {
    id: String,
    account_id: String,
    account_name: String,
    category_id: Option<String>,
    category_name: Option<String>,
    description: String,
    amount_in_cents: i64,
    day_of_month: i64,
    start_month: String,
    end_month: Option<String>,
    last_generated_month: Option<String>,
    active: bool,
}

fn parse_month(value: &str) -> Result<(), AppError> {
    NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| AppError::Validation("Período mensal inválido".into()))
}

/// Adds `delta` months to a "YYYY-MM" value, wrapping across year boundaries.
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

fn validate_recurring_input(input: &RecurringTransactionInput) -> Result<(), AppError> {
    if input.amount_in_cents == 0 {
        return Err(AppError::Validation("O valor não pode ser zero".into()));
    }
    if !(1..=28).contains(&input.day_of_month) {
        return Err(AppError::Validation(
            "O dia do mês deve estar entre 1 e 28".into(),
        ));
    }
    let description_length = input.description.trim().chars().count();
    if !(1..=200).contains(&description_length) {
        return Err(AppError::Validation(
            "A descrição deve ter entre 1 e 200 caracteres".into(),
        ));
    }
    parse_month(&input.start_month)?;
    if let Some(end) = &input.end_month {
        parse_month(end)?;
        if end < &input.start_month {
            return Err(AppError::Validation(
                "O mês final não pode ser anterior ao mês inicial".into(),
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_recurring_transactions(
    state: State<'_, AppState>,
) -> Result<Vec<RecurringTransaction>, AppError> {
    let rows = sqlx::query(
        "SELECT r.id,r.account_id,a.name account_name,r.category_id,c.name category_name,
         r.description,r.amount_cents,r.day_of_month,r.start_month,r.end_month,r.last_generated_month,r.active
         FROM recurring_transactions r
         JOIN accounts a ON a.id=r.account_id
         LEFT JOIN categories c ON c.id=r.category_id
         WHERE r.deleted_at IS NULL ORDER BY r.active DESC, r.description"
    ).fetch_all(&state.db).await?;
    Ok(rows
        .into_iter()
        .map(|row| RecurringTransaction {
            id: row.get("id"),
            account_id: row.get("account_id"),
            account_name: row.get("account_name"),
            category_id: row.get("category_id"),
            category_name: row.get("category_name"),
            description: row.get("description"),
            amount_in_cents: row.get("amount_cents"),
            day_of_month: row.get("day_of_month"),
            start_month: row.get("start_month"),
            end_month: row.get("end_month"),
            last_generated_month: row.get("last_generated_month"),
            active: row.get::<i64, _>("active") != 0,
        })
        .collect())
}

#[tauri::command]
pub async fn save_recurring_transaction(
    input: RecurringTransactionInput,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    save_recurring_transaction_impl(input, &state.db).await
}

async fn save_recurring_transaction_impl(
    input: RecurringTransactionInput,
    db: &SqlitePool,
) -> Result<String, AppError> {
    validate_recurring_input(&input)?;
    ensure_account_active(db, &input.account_id).await?;
    ensure_category_active(db, &input.category_id).await?;
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO recurring_transactions(id,account_id,category_id,description,amount_cents,day_of_month,start_month,end_month,active)
         VALUES(?,?,?,?,?,?,?,?,1)
         ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,category_id=excluded.category_id,
         description=excluded.description,amount_cents=excluded.amount_cents,day_of_month=excluded.day_of_month,
         start_month=excluded.start_month,end_month=excluded.end_month,active=1,updated_at=datetime('now')"
    ).bind(&id).bind(&input.account_id).bind(&input.category_id).bind(input.description.trim())
        .bind(input.amount_in_cents).bind(input.day_of_month).bind(&input.start_month).bind(&input.end_month)
        .execute(db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn set_recurring_transaction_active(
    id: String,
    active: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE recurring_transactions SET active=?,updated_at=datetime('now') WHERE id=? AND deleted_at IS NULL")
        .bind(active as i64).bind(id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn archive_recurring_transaction(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE recurring_transactions SET deleted_at=datetime('now'),active=0,updated_at=datetime('now') WHERE id=?")
        .bind(id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn sync_recurring_transactions(state: State<'_, AppState>) -> Result<usize, AppError> {
    sync_recurring_transactions_impl(&state.db).await
}

/// Generates due occurrences for every active recurring transaction up to today, skipping months
/// already generated and any month whose day hasn't arrived yet. Idempotent: safe to call on every
/// app launch, since each occurrence is deduplicated by the same fingerprint used for manual entries.
async fn sync_recurring_transactions_impl(db: &SqlitePool) -> Result<usize, AppError> {
    let today = Local::now().date_naive();
    let current_month = today.format("%Y-%m").to_string();
    let rows = sqlx::query(
        "SELECT id,account_id,category_id,description,amount_cents,day_of_month,start_month,end_month,last_generated_month
         FROM recurring_transactions WHERE active=1 AND deleted_at IS NULL AND start_month<=?"
    ).bind(&current_month).fetch_all(db).await?;

    let mut generated = 0usize;
    for row in rows {
        let id: String = row.get("id");
        let account_id: String = row.get("account_id");
        let category_id: Option<String> = row.get("category_id");
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
        if first_pending > current_month {
            continue;
        }
        let last_pending = end_month
            .clone()
            .filter(|end| *end < current_month)
            .unwrap_or_else(|| current_month.clone());
        if first_pending > last_pending {
            continue;
        }

        let mut cursor = first_pending;
        let mut new_last_generated = last_generated_month.clone();
        while cursor <= last_pending {
            if cursor == current_month && day_of_month as u32 > today.day() {
                break;
            }
            let date = format!("{cursor}-{:02}", day_of_month);
            let normalized = crate::domain::import::normalize_description(&description);
            let fp = manual_fingerprint(
                &account_id,
                &date,
                &description,
                &normalized,
                amount_in_cents,
            );
            let collides: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND deleted_at IS NULL",
            )
            .bind(&fp)
            .fetch_one(db)
            .await?;
            if collides == 0 {
                let transaction_id = Uuid::new_v4().to_string();
                let source = category_id.as_ref().map(|_| "manual");
                let merchant = crate::domain::merchant::merchant_key(&normalized);
                sqlx::query(
                    "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,fingerprint,category_id,category_source,recurring_transaction_id,status)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,'cleared')"
                ).bind(&transaction_id).bind(&account_id).bind(&date).bind(&description).bind(&normalized).bind(&merchant)
                    .bind(amount_in_cents).bind(&fp).bind(&category_id).bind(source).bind(&id)
                    .execute(db).await?;
                generated += 1;
            }
            new_last_generated = Some(cursor.clone());
            cursor = shift_month(&cursor, 1)?;
        }
        if new_last_generated != last_generated_month {
            sqlx::query("UPDATE recurring_transactions SET last_generated_month=?,updated_at=datetime('now') WHERE id=?")
                .bind(&new_last_generated).bind(&id).execute(db).await?;
        }
    }
    Ok(generated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{complete_onboarding_impl, OnboardingInput};

    async fn setup() -> (tempfile::TempDir, SqlitePool, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("recurring.db"))
            .await
            .unwrap();
        let onboarding = OnboardingInput {
            display_name: "Pessoa Teste".into(),
            monthly_income_in_cents: None,
            income_day: None,
            financial_goal: None,
            account_name: "Conta".into(),
            account_kind: "checking".into(),
            opening_balance_in_cents: None,
        };
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;
        (directory, db, account_id)
    }

    #[test]
    fn shift_month_wraps_year_boundaries() {
        assert_eq!(shift_month("2026-01", -1).unwrap(), "2025-12");
        assert_eq!(shift_month("2025-12", 1).unwrap(), "2026-01");
    }

    #[tokio::test]
    async fn sync_backfills_missed_months_and_stays_idempotent() {
        let (_directory, db, account_id) = setup().await;
        let past_month = shift_month(&Local::now().format("%Y-%m").to_string(), -2).unwrap();
        save_recurring_transaction_impl(
            RecurringTransactionInput {
                id: None,
                account_id: account_id.clone(),
                category_id: None,
                description: "Assinatura de streaming".into(),
                amount_in_cents: -2990,
                day_of_month: 5,
                start_month: past_month,
                end_month: None,
            },
            &db,
        )
        .await
        .unwrap();

        let first_run = sync_recurring_transactions_impl(&db).await.unwrap();
        // Backfills the two past months plus the current one (if day 5 already elapsed) or the two past months.
        assert!(first_run >= 2);

        let second_run = sync_recurring_transactions_impl(&db).await.unwrap();
        assert_eq!(
            second_run, 0,
            "a second sync must not duplicate already-generated occurrences"
        );
    }

    #[tokio::test]
    async fn sync_does_not_generate_future_occurrence_in_current_month() {
        let (_directory, db, account_id) = setup().await;
        let current_month = Local::now().format("%Y-%m").to_string();
        save_recurring_transaction_impl(
            RecurringTransactionInput {
                id: None,
                account_id,
                category_id: None,
                description: "Aluguel".into(),
                amount_in_cents: -150000,
                day_of_month: 28,
                start_month: current_month.clone(),
                end_month: None,
            },
            &db,
        )
        .await
        .unwrap();

        let today = Local::now().date_naive();
        let generated = sync_recurring_transactions_impl(&db).await.unwrap();
        if today.day() < 28 {
            assert_eq!(generated, 0);
        } else {
            assert_eq!(generated, 1);
        }
    }
}
