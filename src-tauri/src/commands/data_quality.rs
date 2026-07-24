use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::State;

use crate::{application::state::AppState, error::AppError};

const SECTION_LIMIT: i64 = 5;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataQualityReview {
    total_count: i64,
    uncategorized: ReviewSection,
    pending_transactions: ReviewSection,
    account_reconciliations: ReviewSection,
    card_payment_reconciliations: ReviewSection,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSection {
    total_count: i64,
    items: Vec<ReviewItem>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    id: String,
    title: String,
    description: String,
    date: Option<String>,
    amount_in_cents: Option<i64>,
    action_path: String,
    action_label: String,
}

fn section(total_count: i64, items: Vec<ReviewItem>) -> ReviewSection {
    ReviewSection { total_count, items }
}

async fn uncategorized_section(db: &SqlitePool) -> Result<ReviewSection, AppError> {
    let total_count = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM transactions t
         JOIN accounts a ON a.id=t.account_id
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND t.category_id IS NULL",
    )
    .fetch_one(db)
    .await?;
    let rows = sqlx::query(
        "SELECT t.id,t.description,t.date,t.amount_cents,a.name account_name
         FROM transactions t
         JOIN accounts a ON a.id=t.account_id
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND t.category_id IS NULL
         ORDER BY t.date DESC,t.created_at DESC,t.id
         LIMIT ?",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(db)
    .await?;
    Ok(section(
        total_count,
        rows.into_iter()
            .map(|row| ReviewItem {
                id: row.get("id"),
                title: row.get("description"),
                description: format!("Sem categoria em {}", row.get::<String, _>("account_name")),
                date: Some(row.get("date")),
                amount_in_cents: Some(row.get("amount_cents")),
                action_path: "/transactions?uncategorized=1".into(),
                action_label: "Escolher categoria".into(),
            })
            .collect(),
    ))
}

async fn pending_transactions_section(db: &SqlitePool) -> Result<ReviewSection, AppError> {
    let total_count = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM transactions t
         JOIN accounts a ON a.id=t.account_id
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND t.status='pending'",
    )
    .fetch_one(db)
    .await?;
    let rows = sqlx::query(
        "SELECT t.id,t.description,t.date,t.amount_cents,a.name account_name
         FROM transactions t
         JOIN accounts a ON a.id=t.account_id
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND t.status='pending'
         ORDER BY t.date DESC,t.created_at DESC,t.id
         LIMIT ?",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(db)
    .await?;
    Ok(section(
        total_count,
        rows.into_iter()
            .map(|row| ReviewItem {
                id: row.get("id"),
                title: row.get("description"),
                description: format!("A confirmar em {}", row.get::<String, _>("account_name")),
                date: Some(row.get("date")),
                amount_in_cents: Some(row.get("amount_cents")),
                action_path: "/transactions?status=pending".into(),
                action_label: "Revisar lançamento".into(),
            })
            .collect(),
    ))
}

async fn account_reconciliations_section(db: &SqlitePool) -> Result<ReviewSection, AppError> {
    let base = "FROM accounts a
         LEFT JOIN account_balance_checkpoints cp ON cp.id=(
           SELECT latest.id
           FROM account_balance_checkpoints latest
           WHERE latest.account_id=a.id
           ORDER BY latest.as_of_date DESC,latest.created_at DESC,latest.id DESC
           LIMIT 1
         )
         WHERE a.deleted_at IS NULL AND a.kind!='credit_card'
           AND (cp.as_of_date IS NULL OR cp.as_of_date<date('now','-45 days'))";
    let total_count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) {base}"))
        .fetch_one(db)
        .await?;
    let rows = sqlx::query(&format!(
        "SELECT a.id,a.name,cp.as_of_date {base}
         ORDER BY cp.as_of_date IS NOT NULL,cp.as_of_date,a.name
         LIMIT ?"
    ))
    .bind(SECTION_LIMIT)
    .fetch_all(db)
    .await?;
    Ok(section(
        total_count,
        rows.into_iter()
            .map(|row| {
                let last_date: Option<String> = row.get("as_of_date");
                ReviewItem {
                    id: row.get("id"),
                    title: row.get("name"),
                    description: match last_date.as_deref() {
                        Some(date) => format!("Última conferência em {date}"),
                        None => "Saldo ainda não conferido".into(),
                    },
                    date: last_date,
                    amount_in_cents: None,
                    action_path: format!("/accounts?balance={}", row.get::<String, _>("id")),
                    action_label: "Conferir saldo".into(),
                }
            })
            .collect(),
    ))
}

async fn card_payment_reconciliations_section(db: &SqlitePool) -> Result<ReviewSection, AppError> {
    let base = "FROM transactions t
         JOIN accounts a ON a.id=t.account_id
         JOIN credit_card_invoice_items x ON x.transaction_id=t.id
         LEFT JOIN transaction_links l
           ON l.kind='credit_card_payment' AND l.credit_transaction_id=t.id
         WHERE a.kind='credit_card' AND a.deleted_at IS NULL
           AND t.deleted_at IS NULL AND t.amount_cents>0 AND x.line_kind='payment'
           AND (l.id IS NULL OR l.invoice_id IS NULL OR l.debit_transaction_id IS NULL)";
    let total_count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) {base}"))
        .fetch_one(db)
        .await?;
    let rows = sqlx::query(&format!(
        "SELECT t.id,t.description,t.date,t.amount_cents,a.name account_name {base}
         ORDER BY t.date DESC,t.id
         LIMIT ?"
    ))
    .bind(SECTION_LIMIT)
    .fetch_all(db)
    .await?;
    Ok(section(
        total_count,
        rows.into_iter()
            .map(|row| {
                let id: String = row.get("id");
                ReviewItem {
                    action_path: format!("/accounts?reconcile={id}"),
                    id,
                    title: row.get("description"),
                    description: format!(
                        "Pagamento a conciliar em {}",
                        row.get::<String, _>("account_name")
                    ),
                    date: Some(row.get("date")),
                    amount_in_cents: Some(row.get("amount_cents")),
                    action_label: "Conciliar pagamento".into(),
                }
            })
            .collect(),
    ))
}

pub(crate) async fn get_data_quality_review_impl(
    db: &SqlitePool,
) -> Result<DataQualityReview, AppError> {
    let (
        uncategorized,
        pending_transactions,
        account_reconciliations,
        card_payment_reconciliations,
    ) = tokio::try_join!(
        uncategorized_section(db),
        pending_transactions_section(db),
        account_reconciliations_section(db),
        card_payment_reconciliations_section(db),
    )?;
    let total_count = [
        uncategorized.total_count,
        pending_transactions.total_count,
        account_reconciliations.total_count,
        card_payment_reconciliations.total_count,
    ]
    .into_iter()
    .try_fold(0_i64, i64::checked_add)
    .ok_or_else(|| {
        AppError::Validation("A contagem de pendências excede o limite suportado".into())
    })?;
    Ok(DataQualityReview {
        total_count,
        uncategorized,
        pending_transactions,
        account_reconciliations,
        card_payment_reconciliations,
    })
}

#[tauri::command]
pub async fn get_data_quality_review(
    state: State<'_, AppState>,
) -> Result<DataQualityReview, AppError> {
    get_data_quality_review_impl(&state.db).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("review.db"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO accounts(id,name,kind) VALUES
             ('bank','Conta do dia a dia','checking'),
             ('card','Cartão principal','credit_card')",
        )
        .execute(&db)
        .await
        .unwrap();
        (directory, db)
    }

    async fn insert_transaction(
        db: &SqlitePool,
        id: &str,
        account_id: &str,
        date: &str,
        amount_in_cents: i64,
        status: &str,
        category_id: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,amount_cents,
               fingerprint,category_id,status
             ) VALUES(?,?,?,'Mercado','MERCADO',?,?,?,?)",
        )
        .bind(id)
        .bind(account_id)
        .bind(date)
        .bind(amount_in_cents)
        .bind(format!("fp-{id}"))
        .bind(category_id)
        .bind(status)
        .execute(db)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn review_counts_all_items_but_limits_each_sample_to_five() {
        let (_directory, db) = setup().await;
        for index in 0..7 {
            insert_transaction(
                &db,
                &format!("tx-{index}"),
                "bank",
                &format!("2026-07-{}", 10 + index),
                -1_000,
                if index == 0 { "pending" } else { "cleared" },
                None,
            )
            .await;
        }

        let review = get_data_quality_review_impl(&db).await.unwrap();
        assert_eq!(review.uncategorized.total_count, 7);
        assert_eq!(review.uncategorized.items.len(), 5);
        assert_eq!(review.pending_transactions.total_count, 1);
        assert_eq!(review.pending_transactions.items.len(), 1);
        assert_eq!(review.account_reconciliations.total_count, 2);
        assert_eq!(review.total_count, 10);
    }

    #[tokio::test]
    async fn current_checkpoint_removes_bank_account_from_reconciliation_section() {
        let (_directory, db) = setup().await;
        sqlx::query(
            "INSERT INTO account_balance_checkpoints(
               id,account_id,as_of_date,balance_cents,source
             ) VALUES('checkpoint','bank',date('now'),12500,'reconciliation')",
        )
        .execute(&db)
        .await
        .unwrap();

        let review = get_data_quality_review_impl(&db).await.unwrap();
        assert_eq!(review.account_reconciliations.total_count, 1);
        assert_eq!(
            review.account_reconciliations.items[0].id,
            "default-account"
        );
    }

    #[tokio::test]
    async fn incomplete_card_payment_is_actionable_and_fully_reconciled_one_is_not() {
        let (_directory, db) = setup().await;
        insert_transaction(
            &db,
            "card-payment",
            "card",
            "2026-07-20",
            20_000,
            "cleared",
            Some("credit-card-payment"),
        )
        .await;
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at)
             VALUES('review-card-batch','fatura.csv',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoices(
               id,account_id,due_date,purchases_cents,credits_cents,total_cents,status,import_batch_id
             ) VALUES('source-invoice','card','2026-07-25',0,0,0,'open','review-card-batch')",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoice_items(
               invoice_id,transaction_id,source_row,raw_amount_cents,line_kind
             ) VALUES('source-invoice','card-payment',1,20000,'payment')",
        )
        .execute(&db)
        .await
        .unwrap();

        let review = get_data_quality_review_impl(&db).await.unwrap();
        assert_eq!(review.card_payment_reconciliations.total_count, 1);
        assert_eq!(
            review.card_payment_reconciliations.items[0].action_path,
            "/accounts?reconcile=card-payment"
        );
    }
}
