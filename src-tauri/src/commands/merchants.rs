use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::{application::state::AppState, domain::merchant::merchant_key, error::AppError};

/// Number of rows updated per transaction during backfill, so opening the app with a large
/// database (tens of thousands of transactions) never blocks startup for more than ~1s.
const BACKFILL_BATCH_SIZE: i64 = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantAlias {
    id: String,
    merchant_key: String,
    display_name: String,
}

/// Recomputes `merchant_key` for transactions missing it (or for every transaction when `force`
/// is set, e.g. after improving the normalization algorithm). Runs in batches so it never holds
/// a long-lived transaction over the whole table.
pub async fn backfill_merchant_keys_impl(db: &SqlitePool, force: bool) -> Result<usize, AppError> {
    let mut total = 0usize;
    let mut offset: i64 = 0;
    loop {
        let rows = sqlx::query(
            "SELECT id, normalized_description FROM transactions
             WHERE (?1 = 1) OR (merchant_key IS NULL)
             ORDER BY id LIMIT ?2 OFFSET ?3"
        ).bind(force).bind(BACKFILL_BATCH_SIZE).bind(offset).fetch_all(db).await?;
        if rows.is_empty() { break; }
        let batch_len = rows.len();
        let mut tx = db.begin().await?;
        for row in rows {
            let id: String = row.get("id");
            let normalized: String = row.get("normalized_description");
            let key = merchant_key(&normalized);
            sqlx::query("UPDATE transactions SET merchant_key=? WHERE id=?")
                .bind(key).bind(id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        total += batch_len;
        if force { offset += BACKFILL_BATCH_SIZE; }
        if (batch_len as i64) < BACKFILL_BATCH_SIZE { break; }
    }
    Ok(total)
}

#[tauri::command]
pub async fn backfill_merchant_keys(force: bool, state: State<'_, AppState>) -> Result<usize, AppError> {
    backfill_merchant_keys_impl(&state.db, force).await
}

#[tauri::command]
pub async fn list_merchant_aliases(state: State<'_, AppState>) -> Result<Vec<MerchantAlias>, AppError> {
    let rows = sqlx::query("SELECT id,merchant_key,display_name FROM merchant_aliases ORDER BY display_name")
        .fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|row| MerchantAlias {
        id: row.get("id"), merchant_key: row.get("merchant_key"), display_name: row.get("display_name"),
    }).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMerchantAliasInput {
    merchant_key: String,
    display_name: String,
}

#[tauri::command]
pub async fn save_merchant_alias(input: SaveMerchantAliasInput, state: State<'_, AppState>) -> Result<String, AppError> {
    save_merchant_alias_impl(&state.db, &input.merchant_key, &input.display_name).await
}

async fn save_merchant_alias_impl(db: &SqlitePool, merchant_key: &str, display_name: &str) -> Result<String, AppError> {
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > 120 {
        return Err(AppError::Validation("O nome do estabelecimento deve ter entre 1 e 120 caracteres".into()));
    }
    if merchant_key.trim().is_empty() {
        return Err(AppError::Validation("Estabelecimento inválido".into()));
    }
    let id = sqlx::query_scalar::<_, String>("SELECT id FROM merchant_aliases WHERE merchant_key=?")
        .bind(merchant_key).fetch_optional(db).await?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO merchant_aliases(id,merchant_key,display_name) VALUES(?,?,?)
         ON CONFLICT(merchant_key) DO UPDATE SET display_name=excluded.display_name,updated_at=datetime('now')"
    ).bind(&id).bind(merchant_key).bind(display_name).execute(db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn delete_merchant_alias(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    sqlx::query("DELETE FROM merchant_aliases WHERE id=?").bind(id).execute(&state.db).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("merchants.db")).await.unwrap();
        (directory, db)
    }

    #[tokio::test]
    async fn backfill_fills_only_missing_keys_and_is_idempotent() {
        let (_directory, db) = setup().await;
        sqlx::query(
            "INSERT INTO accounts(id,name,kind) VALUES('acc','Conta','checking')"
        ).execute(&db).await.unwrap();
        for i in 0..1200 {
            sqlx::query(
                "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,status)
                 VALUES(?,?,?,?,?,?,?,?)"
            ).bind(format!("tx-{i}")).bind("acc").bind("2026-06-01")
                .bind("SUPERMERCADO BH LTDA").bind("SUPERMERCADO BH LTDA").bind(-1000)
                .bind(format!("fp-{i}")).bind("cleared").execute(&db).await.unwrap();
        }
        let updated = backfill_merchant_keys_impl(&db, false).await.unwrap();
        assert_eq!(updated, 1200);
        let key: String = sqlx::query_scalar("SELECT merchant_key FROM transactions WHERE id='tx-0'")
            .fetch_one(&db).await.unwrap();
        assert_eq!(key, "SUPERMERCADO BH");

        let second_run = backfill_merchant_keys_impl(&db, false).await.unwrap();
        assert_eq!(second_run, 0, "a second backfill without force must not touch already-filled rows");

        let forced_run = backfill_merchant_keys_impl(&db, true).await.unwrap();
        assert_eq!(forced_run, 1200, "force=true recomputes every row");
    }

    #[tokio::test]
    async fn save_merchant_alias_upserts_by_merchant_key() {
        let (_directory, db) = setup().await;
        let key = "SUPERMERCADO BH";
        let id_first = save_merchant_alias_impl(&db, key, "Supermercado BH").await.unwrap();
        let id_second = save_merchant_alias_impl(&db, key, "Super BH").await.unwrap();
        assert_eq!(id_first, id_second, "same merchant_key must update the existing alias, not create a new one");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM merchant_aliases WHERE merchant_key=?")
            .bind(key).fetch_one(&db).await.unwrap();
        assert_eq!(count, 1);
        let name: String = sqlx::query_scalar("SELECT display_name FROM merchant_aliases WHERE merchant_key=?")
            .bind(key).fetch_one(&db).await.unwrap();
        assert_eq!(name, "Super BH");
    }

    #[tokio::test]
    async fn save_merchant_alias_rejects_blank_name() {
        let (_directory, db) = setup().await;
        assert!(save_merchant_alias_impl(&db, "SUPERMERCADO BH", "  ").await.is_err());
    }
}
