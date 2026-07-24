use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::{
    application::state::AppState,
    domain::{import::needs_pix_merchant_identification, merchant::merchant_key},
    error::AppError,
};

/// Number of rows updated per transaction during backfill, so opening the app with a large
/// database (tens of thousands of transactions) never blocks startup for more than ~1s.
const BACKFILL_BATCH_SIZE: i64 = 500;

/// Reclassifies imported PIX descriptions using the same conservative rule used
/// by new previews. It is idempotent and intentionally never auto-identifies a
/// row that is already pending.
pub async fn backfill_pending_pix_identification_impl(db: &SqlitePool) -> Result<usize, AppError> {
    let rows = sqlx::query(
        "SELECT id,description FROM transactions
         WHERE import_batch_id IS NOT NULL
           AND deleted_at IS NULL
           AND merchant_identification_status='legacy'
           AND normalized_description LIKE '%PIX%'",
    )
    .fetch_all(db)
    .await?;
    let mut pending_count = 0usize;
    for rows in rows.chunks(BACKFILL_BATCH_SIZE as usize) {
        let mut tx = db.begin().await?;
        for row in rows {
            let id: String = row.get("id");
            let description: String = row.get("description");
            let is_pending = needs_pix_merchant_identification(&description);
            let status = if is_pending { "pending" } else { "identified" };
            if is_pending {
                pending_count += 1;
                sqlx::query(
                    "UPDATE transactions
                     SET merchant_key=NULL,merchant_identification_status=?
                     WHERE id=? AND merchant_identification_status='legacy'",
                )
                .bind(status)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    "UPDATE transactions SET merchant_identification_status=?
                     WHERE id=? AND merchant_identification_status='legacy'",
                )
                .bind(status)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
    }
    Ok(pending_count)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantAlias {
    id: String,
    merchant_key: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantOption {
    merchant_key: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPixTransaction {
    id: String,
    date: String,
    original_description: String,
    amount_in_cents: i64,
    category: Option<String>,
    suggested_merchant_key: Option<String>,
    suggested_merchant_name: Option<String>,
    suggestion_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyTransactionMerchantInput {
    transaction_id: String,
    merchant_key: Option<String>,
    new_display_name: Option<String>,
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
             WHERE merchant_identification_status != 'pending'
             AND ((?1 = 1) OR (merchant_key IS NULL))
             ORDER BY id LIMIT ?2 OFFSET ?3",
        )
        .bind(force)
        .bind(BACKFILL_BATCH_SIZE)
        .bind(offset)
        .fetch_all(db)
        .await?;
        if rows.is_empty() {
            break;
        }
        let batch_len = rows.len();
        let mut tx = db.begin().await?;
        for row in rows {
            let id: String = row.get("id");
            let normalized: String = row.get("normalized_description");
            let key = merchant_key(&normalized);
            sqlx::query("UPDATE transactions SET merchant_key=? WHERE id=?")
                .bind(key)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        total += batch_len;
        if force {
            offset += BACKFILL_BATCH_SIZE;
        }
        if (batch_len as i64) < BACKFILL_BATCH_SIZE {
            break;
        }
    }
    Ok(total)
}

#[tauri::command]
pub async fn backfill_merchant_keys(
    force: bool,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    backfill_merchant_keys_impl(&state.db, force).await
}

#[tauri::command]
pub async fn list_merchant_aliases(
    state: State<'_, AppState>,
) -> Result<Vec<MerchantAlias>, AppError> {
    let rows = sqlx::query(
        "SELECT id,merchant_key,display_name FROM merchant_aliases ORDER BY display_name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| MerchantAlias {
            id: row.get("id"),
            merchant_key: row.get("merchant_key"),
            display_name: row.get("display_name"),
        })
        .collect())
}

#[tauri::command]
pub async fn list_merchant_options(
    state: State<'_, AppState>,
) -> Result<Vec<MerchantOption>, AppError> {
    list_merchant_options_impl(&state.db).await
}

async fn list_merchant_options_impl(db: &SqlitePool) -> Result<Vec<MerchantOption>, AppError> {
    let rows = sqlx::query(
        "SELECT source.merchant_key,COALESCE(ma.display_name,source.merchant_key) display_name
         FROM (
           SELECT merchant_key FROM transactions
           WHERE deleted_at IS NULL AND merchant_key IS NOT NULL
             AND merchant_identification_status!='pending'
           UNION
           SELECT merchant_key FROM merchant_aliases
         ) source
         LEFT JOIN merchant_aliases ma ON ma.merchant_key=source.merchant_key
         ORDER BY display_name",
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| MerchantOption {
            merchant_key: row.get("merchant_key"),
            display_name: row.get("display_name"),
        })
        .collect())
}

#[tauri::command]
pub async fn list_pending_pix_transactions(
    state: State<'_, AppState>,
) -> Result<Vec<PendingPixTransaction>, AppError> {
    list_pending_pix_transactions_impl(&state.db).await
}

async fn list_pending_pix_transactions_impl(
    db: &SqlitePool,
) -> Result<Vec<PendingPixTransaction>, AppError> {
    let rows = sqlx::query(
        "SELECT t.id,t.date,t.description,t.amount_cents,c.name category,t.category_id
         FROM transactions t
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL AND t.import_batch_id IS NOT NULL
           AND t.merchant_identification_status='pending'
         ORDER BY t.date DESC,t.id DESC",
    )
    .fetch_all(db)
    .await?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let amount: i64 = row.get("amount_cents");
        let category_id: Option<String> = row.get("category_id");
        let suggestions = sqlx::query(
            "SELECT h.merchant_key,COALESCE(ma.display_name,h.merchant_key) display_name,COUNT(*) use_count
             FROM transactions h
             LEFT JOIN merchant_aliases ma ON ma.merchant_key=h.merchant_key
             WHERE h.deleted_at IS NULL AND h.merchant_identification_status!='pending'
               AND h.merchant_key IS NOT NULL AND h.amount_cents=?
               AND ((? IS NULL AND h.category_id IS NULL) OR h.category_id=?)
             GROUP BY h.merchant_key,display_name
             ORDER BY use_count DESC,display_name
             LIMIT 2",
        )
        .bind(amount)
        .bind(&category_id)
        .bind(&category_id)
        .fetch_all(db)
        .await?;
        let total_matching: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions h
             WHERE h.deleted_at IS NULL AND h.merchant_identification_status!='pending'
               AND h.merchant_key IS NOT NULL AND h.amount_cents=?
               AND ((? IS NULL AND h.category_id IS NULL) OR h.category_id=?)",
        )
        .bind(amount)
        .bind(&category_id)
        .bind(&category_id)
        .fetch_one(db)
        .await?;
        let confident = suggestions.first().filter(|top| {
            let count: i64 = top.get("use_count");
            let runner_up = suggestions
                .get(1)
                .map(|item| item.get::<i64, _>("use_count"))
                .unwrap_or(0);
            count >= 2 && count > runner_up && count * 100 >= total_matching * 70
        });
        result.push(PendingPixTransaction {
            id: row.get("id"),
            date: row.get("date"),
            original_description: row.get("description"),
            amount_in_cents: amount,
            category: row.get("category"),
            suggested_merchant_key: confident.map(|item| item.get("merchant_key")),
            suggested_merchant_name: confident.map(|item| item.get("display_name")),
            suggestion_reason: confident.map(|_| {
                "Mesmo valor e categoria em pelo menos dois lançamentos confirmados".into()
            }),
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn identify_transaction_merchant(
    input: IdentifyTransactionMerchantInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    identify_transaction_merchant_impl(input, &state.db).await
}

async fn identify_transaction_merchant_impl(
    input: IdentifyTransactionMerchantInput,
    db: &SqlitePool,
) -> Result<(), AppError> {
    let existing_key = input
        .merchant_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let new_name = input
        .new_display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if existing_key.is_some() == new_name.is_some() {
        return Err(AppError::Validation(
            "Escolha um estabelecimento existente ou informe um novo nome".into(),
        ));
    }
    if new_name.is_some_and(|name| name.chars().count() > 120) {
        return Err(AppError::Validation(
            "O nome do estabelecimento deve ter entre 1 e 120 caracteres".into(),
        ));
    }
    let mut tx = db.begin().await?;
    let pending_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transactions
         WHERE id=? AND deleted_at IS NULL AND import_batch_id IS NOT NULL
           AND merchant_identification_status='pending'",
    )
    .bind(&input.transaction_id)
    .fetch_one(&mut *tx)
    .await?;
    if pending_exists == 0 {
        return Err(AppError::Validation("Pix pendente não encontrado".into()));
    }
    let key = if let Some(key) = existing_key {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM (
               SELECT merchant_key FROM merchant_aliases WHERE merchant_key=?
               UNION ALL
               SELECT merchant_key FROM transactions
               WHERE merchant_key=? AND merchant_identification_status!='pending' LIMIT 1
             )",
        )
        .bind(key)
        .bind(key)
        .fetch_one(&mut *tx)
        .await?;
        if exists == 0 {
            return Err(AppError::Validation(
                "Estabelecimento não encontrado".into(),
            ));
        }
        key.to_string()
    } else {
        let key = format!("USER:{}", Uuid::new_v4());
        sqlx::query("INSERT INTO merchant_aliases(id,merchant_key,display_name) VALUES(?,?,?)")
            .bind(Uuid::new_v4().to_string())
            .bind(&key)
            .bind(new_name.unwrap())
            .execute(&mut *tx)
            .await?;
        key
    };
    sqlx::query(
        "UPDATE transactions
         SET merchant_key=?,merchant_identification_status='confirmed',display_description=NULL
         WHERE id=?",
    )
    .bind(key)
    .bind(&input.transaction_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMerchantAliasInput {
    merchant_key: String,
    display_name: String,
}

#[tauri::command]
pub async fn save_merchant_alias(
    input: SaveMerchantAliasInput,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    save_merchant_alias_impl(&state.db, &input.merchant_key, &input.display_name).await
}

async fn save_merchant_alias_impl(
    db: &SqlitePool,
    merchant_key: &str,
    display_name: &str,
) -> Result<String, AppError> {
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > 120 {
        return Err(AppError::Validation(
            "O nome do estabelecimento deve ter entre 1 e 120 caracteres".into(),
        ));
    }
    if merchant_key.trim().is_empty() {
        return Err(AppError::Validation("Estabelecimento inválido".into()));
    }
    let id =
        sqlx::query_scalar::<_, String>("SELECT id FROM merchant_aliases WHERE merchant_key=?")
            .bind(merchant_key)
            .fetch_optional(db)
            .await?
            .unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO merchant_aliases(id,merchant_key,display_name) VALUES(?,?,?)
         ON CONFLICT(merchant_key) DO UPDATE SET display_name=excluded.display_name,updated_at=datetime('now')"
    ).bind(&id).bind(merchant_key).bind(display_name).execute(db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn delete_merchant_alias(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    sqlx::query("DELETE FROM merchant_aliases WHERE id=?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("merchants.db"))
            .await
            .unwrap();
        (directory, db)
    }

    #[tokio::test]
    async fn backfill_fills_only_missing_keys_and_is_idempotent() {
        let (_directory, db) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('acc','Conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        for i in 0..1200 {
            sqlx::query(
                "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,status)
                 VALUES(?,?,?,?,?,?,?,?)"
            ).bind(format!("tx-{i}")).bind("acc").bind("2026-06-01")
                .bind("SUPERMERCADO BH LTDA").bind("SUPERMERCADO BH LTDA").bind(-1000)
                .bind(format!("fp-{i}")).bind("cleared").execute(&db).await.unwrap();
        }
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,
             fingerprint,status,merchant_identification_status)
             VALUES('pending-pix','acc','2026-06-01','Pix emitido outra IF','PIX EMITIDO OUTRA IF',
             -1000,'pending-fp','cleared','pending')",
        )
        .execute(&db)
        .await
        .unwrap();
        let updated = backfill_merchant_keys_impl(&db, false).await.unwrap();
        assert_eq!(updated, 1200);
        let key: String =
            sqlx::query_scalar("SELECT merchant_key FROM transactions WHERE id='tx-0'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(key, "SUPERMERCADO BH");

        let second_run = backfill_merchant_keys_impl(&db, false).await.unwrap();
        assert_eq!(
            second_run, 0,
            "a second backfill without force must not touch already-filled rows"
        );

        let forced_run = backfill_merchant_keys_impl(&db, true).await.unwrap();
        assert_eq!(forced_run, 1200, "force=true recomputes every row");
        let pending_key: Option<String> =
            sqlx::query_scalar("SELECT merchant_key FROM transactions WHERE id='pending-pix'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(pending_key, None);
    }

    #[tokio::test]
    async fn historical_pix_backfill_uses_the_same_conservative_classifier() {
        let (_directory, db) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('acc','Conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at)
             VALUES('batch-history','extrato.ofx',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        let cases = [
            ("generic", "PIX RECEBIDO", "pending"),
            ("numeric", "PIX emitido outra IF 123456", "pending"),
            ("dated", "PIX enviado 24/07/2026", "pending"),
            ("named", "PIX QRS MERCADO CENTRAL", "pending"),
            ("own-account", "PIX IF-MSM", "identified"),
        ];
        for (id, description, _) in cases {
            sqlx::query(
                "INSERT INTO transactions(id,account_id,date,description,normalized_description,
                 merchant_key,amount_cents,fingerprint,status,import_batch_id)
                 VALUES(?,'acc','2026-07-24',?,?,?,-1000,?,'cleared','batch-history')",
            )
            .bind(id)
            .bind(description)
            .bind(crate::domain::import::normalize_description(description))
            .bind(merchant_key(description))
            .bind(format!("fp-{id}"))
            .execute(&db)
            .await
            .unwrap();
        }

        assert_eq!(
            backfill_pending_pix_identification_impl(&db).await.unwrap(),
            4
        );
        assert_eq!(
            backfill_pending_pix_identification_impl(&db).await.unwrap(),
            0,
            "a maintenance rerun must be idempotent"
        );
        for (id, _, expected_status) in cases {
            let row = sqlx::query(
                "SELECT merchant_key,merchant_identification_status
                 FROM transactions WHERE id=?",
            )
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
            assert_eq!(
                row.get::<String, _>("merchant_identification_status"),
                expected_status
            );
            assert_eq!(
                row.get::<Option<String>, _>("merchant_key").is_some(),
                expected_status == "identified"
            );
        }
    }

    #[tokio::test]
    async fn save_merchant_alias_upserts_by_merchant_key() {
        let (_directory, db) = setup().await;
        let key = "SUPERMERCADO BH";
        let id_first = save_merchant_alias_impl(&db, key, "Supermercado BH")
            .await
            .unwrap();
        let id_second = save_merchant_alias_impl(&db, key, "Super BH")
            .await
            .unwrap();
        assert_eq!(
            id_first, id_second,
            "same merchant_key must update the existing alias, not create a new one"
        );

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM merchant_aliases WHERE merchant_key=?")
                .bind(key)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(count, 1);
        let name: String =
            sqlx::query_scalar("SELECT display_name FROM merchant_aliases WHERE merchant_key=?")
                .bind(key)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(name, "Super BH");
    }

    #[tokio::test]
    async fn save_merchant_alias_rejects_blank_name() {
        let (_directory, db) = setup().await;
        assert!(save_merchant_alias_impl(&db, "SUPERMERCADO BH", "  ")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn merchant_options_include_income_only_keys_and_alias_only_entries() {
        let (_directory, db) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('acc','Conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,
             merchant_key,amount_cents,fingerprint,status,merchant_identification_status)
             VALUES('income','acc','2026-07-24','Cliente recorrente','CLIENTE RECORRENTE',
             'CLIENTE RECORRENTE',10000,'fp-income','cleared','identified')",
        )
        .execute(&db)
        .await
        .unwrap();
        save_merchant_alias_impl(&db, "ALIAS SEM DESPESA", "Contato conhecido")
            .await
            .unwrap();

        let options = list_merchant_options_impl(&db).await.unwrap();
        assert!(options
            .iter()
            .any(|option| option.merchant_key == "CLIENTE RECORRENTE"));
        assert!(options.iter().any(|option| {
            option.merchant_key == "ALIAS SEM DESPESA" && option.display_name == "Contato conhecido"
        }));
    }

    #[tokio::test]
    async fn identifying_pending_pix_is_explicit_per_transaction() {
        let (_directory, db) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('acc','Conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at) VALUES('batch','extrato.ofx',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        for id in ["pix-existing", "pix-new"] {
            sqlx::query(
                "INSERT INTO transactions(id,account_id,date,description,normalized_description,
                 amount_cents,fingerprint,status,import_batch_id,merchant_identification_status)
                 VALUES(?,'acc','2026-06-01','Pix emitido outra IF','PIX EMITIDO OUTRA IF',
                 -3500,?,'cleared','batch','pending')",
            )
            .bind(id)
            .bind(format!("fp-{id}"))
            .execute(&db)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,
             amount_cents,fingerprint,status)
             VALUES('known','acc','2026-05-01','Feira Central','FEIRA CENTRAL','FEIRA CENTRAL',
             -3500,'fp-known','cleared')",
        )
        .execute(&db)
        .await
        .unwrap();

        let pending = list_pending_pix_transactions_impl(&db).await.unwrap();
        assert_eq!(pending.len(), 2);
        identify_transaction_merchant_impl(
            IdentifyTransactionMerchantInput {
                transaction_id: "pix-existing".into(),
                merchant_key: Some("FEIRA CENTRAL".into()),
                new_display_name: None,
            },
            &db,
        )
        .await
        .unwrap();
        identify_transaction_merchant_impl(
            IdentifyTransactionMerchantInput {
                transaction_id: "pix-new".into(),
                merchant_key: None,
                new_display_name: Some("Padaria da praça".into()),
            },
            &db,
        )
        .await
        .unwrap();

        let existing: (String, String, String) = sqlx::query_as(
            "SELECT merchant_key,merchant_identification_status,description
             FROM transactions WHERE id='pix-existing'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(
            existing,
            (
                "FEIRA CENTRAL".into(),
                "confirmed".into(),
                "Pix emitido outra IF".into()
            )
        );
        assert_eq!(
            backfill_pending_pix_identification_impl(&db).await.unwrap(),
            0,
            "startup maintenance must never undo an explicit confirmation"
        );
        let confirmed_after_restart: (String, String) = sqlx::query_as(
            "SELECT merchant_key,merchant_identification_status
             FROM transactions WHERE id='pix-existing'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(
            confirmed_after_restart,
            ("FEIRA CENTRAL".into(), "confirmed".into())
        );
        let created: (String, String) = sqlx::query_as(
            "SELECT t.merchant_key,ma.display_name
             FROM transactions t JOIN merchant_aliases ma ON ma.merchant_key=t.merchant_key
             WHERE t.id='pix-new'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert!(created.0.starts_with("USER:"));
        assert_eq!(created.1, "Padaria da praça");
        assert!(list_pending_pix_transactions_impl(&db)
            .await
            .unwrap()
            .is_empty());
    }
}
