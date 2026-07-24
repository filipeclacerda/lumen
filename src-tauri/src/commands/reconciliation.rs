use std::collections::HashSet;

use chrono::{Datelike, Days, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::{
    application::state::AppState,
    domain::cashflow_forecast::{
        calculate_cashflow_forecast, ForecastConfidence, ForecastLayer, ForecastMovement,
        ForecastOrigin,
    },
    error::AppError,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceCheckpointInput {
    account_id: String,
    as_of_date: String,
    balance_in_cents: i64,
    source: String,
    note: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BalanceCheckpoint {
    id: String,
    account_id: String,
    as_of_date: String,
    balance_in_cents: i64,
    source: String,
    note: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationPreview {
    account_id: String,
    as_of_date: String,
    reported_balance_in_cents: i64,
    calculated_balance_in_cents: i64,
    difference_in_cents: i64,
    latest_checkpoint: Option<BalanceCheckpoint>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountBalanceSummary {
    account_id: String,
    realized_balance_in_cents: i64,
    pending_balance_in_cents: i64,
    forecast_balance_in_cents: i64,
    minimum_balance_in_cents: i64,
    minimum_balance_date: Option<String>,
    scheduled_count: usize,
    last_reconciled_at: Option<String>,
    needs_reconciliation: bool,
}

fn validate_checkpoint_input(input: &BalanceCheckpointInput) -> Result<(), AppError> {
    NaiveDate::parse_from_str(&input.as_of_date, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Data de conciliação inválida".into()))?;
    if !["manual", "import", "reconciliation"].contains(&input.source.as_str()) {
        return Err(AppError::Validation(
            "Origem do saldo informado inválida".into(),
        ));
    }
    if input
        .note
        .as_deref()
        .is_some_and(|note| note.chars().count() > 500)
    {
        return Err(AppError::Validation(
            "A observação deve ter no máximo 500 caracteres".into(),
        ));
    }
    Ok(())
}

async fn ensure_active_account(db: &SqlitePool, account_id: &str) -> Result<(), AppError> {
    let exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM accounts WHERE id=? AND deleted_at IS NULL")
            .bind(account_id)
            .fetch_one(db)
            .await?;
    if exists == 0 {
        return Err(AppError::Validation("Conta não encontrada".into()));
    }
    Ok(())
}

fn checkpoint_from_row(row: &sqlx::sqlite::SqliteRow) -> BalanceCheckpoint {
    BalanceCheckpoint {
        id: row.get("id"),
        account_id: row.get("account_id"),
        as_of_date: row.get("as_of_date"),
        balance_in_cents: row.get("balance_cents"),
        source: row.get("source"),
        note: row.get("note"),
        created_at: row.get("created_at"),
    }
}

async fn latest_checkpoint_on_or_before(
    db: &SqlitePool,
    account_id: &str,
    as_of_date: &str,
) -> Result<Option<BalanceCheckpoint>, AppError> {
    let row = sqlx::query(
        "SELECT id,account_id,as_of_date,balance_cents,source,note,created_at
         FROM account_balance_checkpoints
         WHERE account_id=? AND as_of_date<=?
         ORDER BY as_of_date DESC,created_at DESC,id DESC
         LIMIT 1",
    )
    .bind(account_id)
    .bind(as_of_date)
    .fetch_optional(db)
    .await?;
    Ok(row.as_ref().map(checkpoint_from_row))
}

async fn calculated_balance_at(
    db: &SqlitePool,
    account_id: &str,
    as_of_date: &str,
    checkpoint: Option<&BalanceCheckpoint>,
) -> Result<i64, AppError> {
    let (base_balance, after_date) = checkpoint
        .map(|checkpoint| {
            (
                checkpoint.balance_in_cents,
                Some(checkpoint.as_of_date.as_str()),
            )
        })
        .unwrap_or((0, None));
    let delta: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents),0)
         FROM transactions
         WHERE account_id=? AND deleted_at IS NULL AND status='cleared'
         AND date<=? AND (? IS NULL OR date>?)",
    )
    .bind(account_id)
    .bind(as_of_date)
    .bind(after_date)
    .bind(after_date)
    .fetch_one(db)
    .await?;
    base_balance
        .checked_add(delta)
        .ok_or_else(|| AppError::Validation("O saldo calculado excede o limite suportado".into()))
}

pub(crate) async fn reconciliation_preview_impl(
    input: &BalanceCheckpointInput,
    db: &SqlitePool,
) -> Result<ReconciliationPreview, AppError> {
    validate_checkpoint_input(input)?;
    ensure_active_account(db, &input.account_id).await?;
    let latest_checkpoint =
        latest_checkpoint_on_or_before(db, &input.account_id, &input.as_of_date).await?;
    let calculated_balance_in_cents = calculated_balance_at(
        db,
        &input.account_id,
        &input.as_of_date,
        latest_checkpoint.as_ref(),
    )
    .await?;
    let difference_in_cents = input
        .balance_in_cents
        .checked_sub(calculated_balance_in_cents)
        .ok_or_else(|| {
            AppError::Validation("A diferença de saldo excede o limite suportado".into())
        })?;
    Ok(ReconciliationPreview {
        account_id: input.account_id.clone(),
        as_of_date: input.as_of_date.clone(),
        reported_balance_in_cents: input.balance_in_cents,
        calculated_balance_in_cents,
        difference_in_cents,
        latest_checkpoint,
    })
}

#[tauri::command]
pub async fn get_reconciliation_preview(
    input: BalanceCheckpointInput,
    state: State<'_, AppState>,
) -> Result<ReconciliationPreview, AppError> {
    reconciliation_preview_impl(&input, &state.db).await
}

pub(crate) async fn record_balance_checkpoint_impl(
    input: BalanceCheckpointInput,
    db: &SqlitePool,
) -> Result<BalanceCheckpoint, AppError> {
    validate_checkpoint_input(&input)?;
    ensure_active_account(db, &input.account_id).await?;
    let note = input
        .note
        .map(|note| note.trim().to_string())
        .filter(|note| !note.is_empty());
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO account_balance_checkpoints(
           id,account_id,as_of_date,balance_cents,source,note
         ) VALUES(?,?,?,?,?,?)",
    )
    .bind(&id)
    .bind(&input.account_id)
    .bind(&input.as_of_date)
    .bind(input.balance_in_cents)
    .bind(&input.source)
    .bind(&note)
    .execute(db)
    .await?;
    let row = sqlx::query(
        "SELECT id,account_id,as_of_date,balance_cents,source,note,created_at
         FROM account_balance_checkpoints WHERE id=?",
    )
    .bind(&id)
    .fetch_one(db)
    .await?;
    Ok(checkpoint_from_row(&row))
}

#[tauri::command]
pub async fn record_balance_checkpoint(
    input: BalanceCheckpointInput,
    state: State<'_, AppState>,
) -> Result<BalanceCheckpoint, AppError> {
    record_balance_checkpoint_impl(input, &state.db).await
}

pub(crate) async fn list_account_balance_summaries_impl(
    db: &SqlitePool,
) -> Result<Vec<AccountBalanceSummary>, AppError> {
    list_account_balance_summaries_at(db, Local::now().date_naive()).await
}

async fn list_account_balance_summaries_at(
    db: &SqlitePool,
    today: NaiveDate,
) -> Result<Vec<AccountBalanceSummary>, AppError> {
    let horizon = today
        .checked_add_days(Days::new(30))
        .ok_or_else(|| AppError::Validation("A janela da projeção é inválida".into()))?;
    let stale_before = today
        .checked_sub_days(Days::new(45))
        .ok_or_else(|| AppError::Validation("A janela de conciliação é inválida".into()))?
        .format("%Y-%m-%d")
        .to_string();
    let today_iso = today.format("%Y-%m-%d").to_string();
    let horizon_iso = horizon.format("%Y-%m-%d").to_string();
    let account_rows = sqlx::query(
        "SELECT a.id account_id,a.name,
                cp.as_of_date checkpoint_date,cp.balance_cents checkpoint_balance
         FROM accounts a
         LEFT JOIN account_balance_checkpoints cp ON cp.id=(
           SELECT latest.id FROM account_balance_checkpoints latest
           WHERE latest.account_id=a.id AND latest.as_of_date<=?
           ORDER BY latest.as_of_date DESC,latest.created_at DESC,latest.id DESC LIMIT 1
         )
         WHERE a.deleted_at IS NULL AND a.kind!='credit_card'
         ORDER BY a.name",
    )
    .bind(&today_iso)
    .fetch_all(db)
    .await?;

    let existing_recurring_rows = sqlx::query(
        "SELECT account_id,recurring_transaction_id,date
         FROM transactions
         WHERE deleted_at IS NULL AND recurring_transaction_id IS NOT NULL
           AND date>? AND date<=?",
    )
    .bind(&today_iso)
    .bind(&horizon_iso)
    .fetch_all(db)
    .await?;
    let existing_recurrences = existing_recurring_rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("account_id"),
                row.get::<String, _>("recurring_transaction_id"),
                row.get::<String, _>("date"),
            )
        })
        .collect::<HashSet<_>>();

    let mut summaries = Vec::with_capacity(account_rows.len());
    for account in account_rows {
        let account_id: String = account.get("account_id");
        let checkpoint_date: Option<String> = account.get("checkpoint_date");
        let checkpoint_balance: Option<i64> = account.get("checkpoint_balance");
        let transaction_rows = sqlx::query(
            "SELECT t.date,t.amount_cents,t.status,t.import_batch_id,t.recurring_transaction_id,
                    links.kind link_kind
             FROM transactions t
             LEFT JOIN transaction_links links
               ON t.id=links.debit_transaction_id OR t.id=links.credit_transaction_id
             WHERE t.account_id=? AND t.deleted_at IS NULL
               AND t.date<=? AND (? IS NULL OR t.date>?)
             ORDER BY t.date,t.id",
        )
        .bind(&account_id)
        .bind(&horizon_iso)
        .bind(checkpoint_date.as_deref())
        .bind(checkpoint_date.as_deref())
        .fetch_all(db)
        .await?;
        let mut pending_count = 0usize;
        let mut movements = Vec::with_capacity(transaction_rows.len());
        for transaction in transaction_rows {
            let date: String = transaction.get("date");
            let status: String = transaction.get("status");
            let layer = match status.as_str() {
                "cleared" if date <= today_iso => ForecastLayer::Realized,
                "cleared" | "pending" => {
                    pending_count += 1;
                    ForecastLayer::Pending
                }
                _ => continue,
            };
            let link_kind: Option<String> = transaction.get("link_kind");
            let recurring_id: Option<String> = transaction.get("recurring_transaction_id");
            let import_batch_id: Option<String> = transaction.get("import_batch_id");
            let origin = if link_kind.as_deref() == Some("transfer") {
                ForecastOrigin::Transfer
            } else if recurring_id.is_some() {
                ForecastOrigin::Recurrence
            } else if import_batch_id.is_some() {
                ForecastOrigin::Import
            } else {
                ForecastOrigin::Transaction
            };
            movements.push(ForecastMovement {
                date,
                amount_in_cents: transaction.get("amount_cents"),
                layer,
                confidence: ForecastConfidence::Confirmed,
                origin,
                // This is an account-scoped forecast: a transfer leg must affect this account.
                transfer_id: None,
            });
        }

        let recurring_rows = sqlx::query(
            "SELECT id,amount_cents,day_of_month,start_month,end_month
             FROM recurring_transactions
             WHERE account_id=? AND active=1 AND deleted_at IS NULL
               AND start_month<=? AND (end_month IS NULL OR end_month>=?)",
        )
        .bind(&account_id)
        .bind(&horizon_iso[..7])
        .bind(&today_iso[..7])
        .fetch_all(db)
        .await?;
        let mut scheduled_count = 0usize;
        for recurring in recurring_rows {
            let recurring_id: String = recurring.get("id");
            let amount_in_cents: i64 = recurring.get("amount_cents");
            let configured_day: u32 = recurring.get::<i64, _>("day_of_month") as u32;
            let start_month: String = recurring.get("start_month");
            let end_month: Option<String> = recurring.get("end_month");
            let mut date = today
                .succ_opt()
                .ok_or_else(|| AppError::Validation("A janela da projeção é inválida".into()))?;
            while date <= horizon {
                let month = date.format("%Y-%m").to_string();
                let effective_day = configured_day.min(last_day_of_month(date));
                let date_iso = date.format("%Y-%m-%d").to_string();
                if date.day() == effective_day
                    && month >= start_month
                    && end_month.as_ref().is_none_or(|end| month <= *end)
                    && !existing_recurrences.contains(&(
                        account_id.clone(),
                        recurring_id.clone(),
                        date_iso.clone(),
                    ))
                {
                    movements.push(ForecastMovement {
                        date: date_iso,
                        amount_in_cents,
                        layer: ForecastLayer::Scheduled,
                        confidence: ForecastConfidence::Estimated,
                        origin: ForecastOrigin::Recurrence,
                        transfer_id: None,
                    });
                    scheduled_count += 1;
                }
                date = date.succ_opt().ok_or_else(|| {
                    AppError::Validation("A janela da projeção é inválida".into())
                })?;
            }
        }

        let forecast = calculate_cashflow_forecast(checkpoint_balance.unwrap_or(0), &movements)
            .map_err(|error| AppError::Validation(error.to_string()))?;
        summaries.push(AccountBalanceSummary {
            account_id,
            realized_balance_in_cents: forecast.realized_balance_in_cents,
            pending_balance_in_cents: forecast.balance_after_pending_in_cents,
            forecast_balance_in_cents: forecast.projected_balance_in_cents,
            minimum_balance_in_cents: forecast.minimum_balance_in_cents,
            minimum_balance_date: forecast.minimum_balance_date,
            scheduled_count,
            last_reconciled_at: checkpoint_date.clone(),
            needs_reconciliation: checkpoint_date
                .as_deref()
                .is_none_or(|date| date < stale_before.as_str())
                || pending_count > 0,
        });
    }
    Ok(summaries)
}

fn last_day_of_month(date: NaiveDate) -> u32 {
    let next_month = if date.month() == 12 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1)
    }
    .expect("a valid date always has a valid following month");
    next_month
        .pred_opt()
        .expect("month has a previous day")
        .day()
}

#[tauri::command]
pub async fn list_account_balance_summaries(
    state: State<'_, AppState>,
) -> Result<Vec<AccountBalanceSummary>, AppError> {
    list_account_balance_summaries_impl(&state.db).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let db =
            crate::infrastructure::database::connect(&directory.path().join("reconciliation.db"))
                .await
                .unwrap();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('acc','Conta teste','checking')")
            .execute(&db)
            .await
            .unwrap();
        (directory, db)
    }

    async fn insert_transaction(
        db: &SqlitePool,
        id: &str,
        date: &str,
        amount_in_cents: i64,
        status: &str,
    ) {
        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,amount_cents,fingerprint,status
             ) VALUES(?,'acc',?,'Movimento','MOVIMENTO',?,?,?)",
        )
        .bind(id)
        .bind(date)
        .bind(amount_in_cents)
        .bind(format!("fp-{id}"))
        .bind(status)
        .execute(db)
        .await
        .unwrap();
    }

    fn input(date: &str, balance_in_cents: i64) -> BalanceCheckpointInput {
        BalanceCheckpointInput {
            account_id: "acc".into(),
            as_of_date: date.into(),
            balance_in_cents,
            source: "manual".into(),
            note: None,
        }
    }

    #[tokio::test]
    async fn checkpoint_is_an_end_of_day_anchor_without_creating_a_transaction() {
        let (_directory, db) = setup().await;
        insert_transaction(&db, "before", "2026-07-10", 10_000, "cleared").await;
        record_balance_checkpoint_impl(input("2026-07-10", 12_000), &db)
            .await
            .unwrap();
        insert_transaction(&db, "same-day", "2026-07-10", 5_000, "cleared").await;
        insert_transaction(&db, "after", "2026-07-11", -2_000, "cleared").await;

        let preview = reconciliation_preview_impl(&input("2026-07-12", 10_000), &db)
            .await
            .unwrap();
        assert_eq!(preview.calculated_balance_in_cents, 10_000);
        assert_eq!(preview.difference_in_cents, 0);
        let transaction_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE account_id='acc'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(transaction_count, 3);
    }

    #[tokio::test]
    async fn preview_uses_ledger_when_there_is_no_earlier_checkpoint() {
        let (_directory, db) = setup().await;
        insert_transaction(&db, "cleared", "2026-07-10", 8_000, "cleared").await;
        insert_transaction(&db, "pending", "2026-07-10", 3_000, "pending").await;

        let preview = reconciliation_preview_impl(&input("2026-07-10", 7_500), &db)
            .await
            .unwrap();
        assert_eq!(preview.calculated_balance_in_cents, 8_000);
        assert_eq!(preview.difference_in_cents, -500);
        assert!(preview.latest_checkpoint.is_none());
    }

    #[tokio::test]
    async fn summary_layers_pending_balance_over_realized_balance() {
        let (_directory, db) = setup().await;
        record_balance_checkpoint_impl(input("2026-07-10", 20_000), &db)
            .await
            .unwrap();
        insert_transaction(&db, "same-day", "2026-07-10", 50_000, "cleared").await;
        insert_transaction(&db, "cleared", "2026-07-11", -4_000, "cleared").await;
        insert_transaction(&db, "pending", "2026-07-12", -3_000, "pending").await;

        let summaries = list_account_balance_summaries_impl(&db).await.unwrap();
        let summary = summaries
            .iter()
            .find(|item| item.account_id == "acc")
            .unwrap();
        assert_eq!(summary.realized_balance_in_cents, 16_000);
        assert_eq!(summary.pending_balance_in_cents, 13_000);
        assert_eq!(summary.forecast_balance_in_cents, 13_000);
        assert_eq!(summary.minimum_balance_in_cents, 13_000);
        assert_eq!(summary.minimum_balance_date.as_deref(), Some("2026-07-12"));
        assert_eq!(summary.scheduled_count, 0);
        assert_eq!(summary.last_reconciled_at.as_deref(), Some("2026-07-10"));
        assert!(summary.needs_reconciliation);
    }

    #[tokio::test]
    async fn forecast_includes_recurrences_through_the_thirtieth_day_and_clamps_month_end() {
        let (_directory, db) = setup().await;
        record_balance_checkpoint_impl(input("2026-01-31", 10_000), &db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO recurring_transactions(
               id,account_id,description,amount_cents,day_of_month,start_month,active
             ) VALUES('rent','acc','Aluguel',-12_000,31,'2026-02',1)",
        )
        .execute(&db)
        .await
        .unwrap();

        let summaries =
            list_account_balance_summaries_at(&db, NaiveDate::from_ymd_opt(2026, 1, 31).unwrap())
                .await
                .unwrap();
        let summary = summaries
            .iter()
            .find(|item| item.account_id == "acc")
            .unwrap();

        assert_eq!(summary.realized_balance_in_cents, 10_000);
        assert_eq!(summary.pending_balance_in_cents, 10_000);
        assert_eq!(summary.forecast_balance_in_cents, -2_000);
        assert_eq!(summary.minimum_balance_in_cents, -2_000);
        assert_eq!(summary.minimum_balance_date.as_deref(), Some("2026-02-28"));
        assert_eq!(summary.scheduled_count, 1);
    }

    #[tokio::test]
    async fn forecast_window_is_inclusive_and_does_not_duplicate_generated_recurrences() {
        let (_directory, db) = setup().await;
        record_balance_checkpoint_impl(input("2026-01-01", 20_000), &db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO recurring_transactions(
               id,account_id,description,amount_cents,day_of_month,start_month,active
             ) VALUES
               ('boundary','acc','No limite',-4_000,31,'2026-01',1),
               ('generated','acc','Já lançado',-3_000,15,'2026-01',1)",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,amount_cents,fingerprint,
               recurring_transaction_id,status
             ) VALUES(
               'generated-tx','acc','2026-01-15','Já lançado','JA LANCADO',-3000,'generated-fp',
               'generated','pending'
             )",
        )
        .execute(&db)
        .await
        .unwrap();

        let summaries =
            list_account_balance_summaries_at(&db, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap())
                .await
                .unwrap();
        let summary = summaries
            .iter()
            .find(|item| item.account_id == "acc")
            .unwrap();

        assert_eq!(summary.pending_balance_in_cents, 17_000);
        assert_eq!(summary.forecast_balance_in_cents, 13_000);
        assert_eq!(summary.minimum_balance_date.as_deref(), Some("2026-01-31"));
        assert_eq!(summary.scheduled_count, 1);
    }

    #[tokio::test]
    async fn account_scoped_forecast_keeps_the_transfer_leg() {
        let (_directory, db) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('other','Outra conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        record_balance_checkpoint_impl(input("2026-01-01", 10_000), &db)
            .await
            .unwrap();
        insert_transaction(&db, "debit", "2026-01-02", -3_000, "cleared").await;
        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,amount_cents,fingerprint,status
             ) VALUES('credit','other','2026-01-02','Transferência','TRANSFERENCIA',3000,'credit-fp','cleared')",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_links(
               id,kind,debit_transaction_id,credit_transaction_id
             ) VALUES('link','transfer','debit','credit')",
        )
        .execute(&db)
        .await
        .unwrap();

        let summaries =
            list_account_balance_summaries_at(&db, NaiveDate::from_ymd_opt(2026, 1, 2).unwrap())
                .await
                .unwrap();
        let summary = summaries
            .iter()
            .find(|item| item.account_id == "acc")
            .unwrap();

        assert_eq!(summary.realized_balance_in_cents, 7_000);
        assert_eq!(summary.forecast_balance_in_cents, 7_000);
    }
}
