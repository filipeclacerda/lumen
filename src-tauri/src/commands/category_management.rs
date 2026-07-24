use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::{application::state::AppState, error::AppError};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryMergeImpact {
    source_category_id: String,
    source_category_name: String,
    target_category_id: String,
    target_category_name: String,
    moved_transactions: i64,
    moved_rules: i64,
    moved_recurring: i64,
    moved_targets: i64,
    moved_children: i64,
}

async fn load_merge_impact(
    db: &SqlitePool,
    source_category_id: &str,
    target_category_id: &str,
) -> Result<CategoryMergeImpact, AppError> {
    if source_category_id == target_category_id {
        return Err(AppError::Validation(
            "Escolha duas categorias diferentes".into(),
        ));
    }

    let source =
        sqlx::query("SELECT name,kind,is_system FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(source_category_id)
            .fetch_optional(db)
            .await?
            .ok_or_else(|| AppError::Validation("Categoria de origem não encontrada".into()))?;
    let target = sqlx::query("SELECT name,kind FROM categories WHERE id=? AND deleted_at IS NULL")
        .bind(target_category_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::Validation("Categoria de destino não encontrada".into()))?;

    let source_kind: String = source.get("kind");
    let target_kind: String = target.get("kind");
    if source_kind != target_kind {
        return Err(AppError::Validation(
            "Só é possível unir categorias do mesmo tipo".into(),
        ));
    }
    if source.get::<i64, _>("is_system") != 0 {
        return Err(AppError::Validation(
            "Categorias essenciais do Lumen não podem ser unidas".into(),
        ));
    }

    async fn count(db: &SqlitePool, sql: &str, id: &str) -> Result<i64, AppError> {
        Ok(sqlx::query_scalar::<_, i64>(sql)
            .bind(id)
            .fetch_one(db)
            .await?)
    }

    Ok(CategoryMergeImpact {
        source_category_id: source_category_id.into(),
        source_category_name: source.get("name"),
        target_category_id: target_category_id.into(),
        target_category_name: target.get("name"),
        moved_transactions: count(
            db,
            "SELECT COUNT(*) FROM transactions WHERE category_id=?",
            source_category_id,
        )
        .await?,
        moved_rules: count(
            db,
            "SELECT COUNT(*) FROM categorization_rules WHERE category_id=? AND deleted_at IS NULL",
            source_category_id,
        )
        .await?,
        moved_recurring: count(
            db,
            "SELECT COUNT(*) FROM recurring_transactions WHERE category_id=? AND deleted_at IS NULL",
            source_category_id,
        )
        .await?,
        moved_targets: count(
            db,
            "SELECT COUNT(*) FROM financial_targets WHERE category_id=? AND deleted_at IS NULL",
            source_category_id,
        )
        .await?,
        moved_children: count(
            db,
            "SELECT COUNT(*) FROM categories WHERE parent_id=? AND deleted_at IS NULL",
            source_category_id,
        )
        .await?,
    })
}

#[tauri::command]
pub async fn preview_category_merge(
    source_category_id: String,
    target_category_id: String,
    state: State<'_, AppState>,
) -> Result<CategoryMergeImpact, AppError> {
    load_merge_impact(&state.db, &source_category_id, &target_category_id).await
}

#[tauri::command]
pub async fn merge_category(
    source_category_id: String,
    target_category_id: String,
    state: State<'_, AppState>,
) -> Result<CategoryMergeImpact, AppError> {
    merge_category_impl(&state.db, &source_category_id, &target_category_id).await
}

async fn merge_category_impl(
    db: &SqlitePool,
    source_category_id: &str,
    target_category_id: &str,
) -> Result<CategoryMergeImpact, AppError> {
    let impact = load_merge_impact(db, source_category_id, target_category_id).await?;
    let mut tx = db.begin().await?;

    sqlx::query("UPDATE transactions SET category_id=? WHERE category_id=?")
        .bind(target_category_id)
        .bind(source_category_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE categorization_rules SET category_id=?,updated_at=datetime('now') WHERE category_id=?",
    )
    .bind(target_category_id)
    .bind(source_category_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE recurring_transactions SET category_id=?,updated_at=datetime('now') WHERE category_id=?",
    )
    .bind(target_category_id)
    .bind(source_category_id)
    .execute(&mut *tx)
    .await?;

    let target_has_budget = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM financial_targets
         WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(target_category_id)
    .fetch_one(&mut *tx)
    .await?
        > 0;
    if target_has_budget {
        sqlx::query(
            "UPDATE financial_targets
             SET enabled=0,deleted_at=datetime('now'),updated_at=datetime('now')
             WHERE category_id=? AND deleted_at IS NULL",
        )
        .bind(source_category_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE financial_targets SET category_id=?,updated_at=datetime('now')
             WHERE category_id=?",
        )
        .bind(target_category_id)
        .bind(source_category_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("UPDATE categories SET parent_id=? WHERE parent_id=? AND deleted_at IS NULL")
        .bind(target_category_id)
        .bind(source_category_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE categories SET deleted_at=datetime('now') WHERE id=?")
        .bind(source_category_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO category_merge_log(
           id,source_category_id,source_category_name,target_category_id,target_category_name,
           moved_transactions,moved_rules,moved_recurring,moved_targets,moved_children
         ) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&impact.source_category_id)
    .bind(&impact.source_category_name)
    .bind(&impact.target_category_id)
    .bind(&impact.target_category_name)
    .bind(impact.moved_transactions)
    .bind(impact.moved_rules)
    .bind(impact.moved_recurring)
    .bind(impact.moved_targets)
    .bind(impact.moved_children)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(impact)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn database() -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("merge.db"))
            .await
            .unwrap();
        (directory, db)
    }

    #[tokio::test]
    async fn merge_moves_dependencies_and_archives_source_atomically() {
        let (_directory, db) = database().await;
        sqlx::query(
            "INSERT INTO categories(id,name,kind,sort_order,is_system) VALUES
             ('source','Mercado antigo','expense',900,0),
             ('target','Mercado','expense',901,0),
             ('child','Padaria','expense',902,0)",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query("UPDATE categories SET parent_id='source' WHERE id='child'")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,amount_cents,fingerprint,category_id
             ) VALUES('merge-tx','default-account','2026-07-01','Mercado','MERCADO',-1000,'merge-fp','source')",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO recurring_transactions(
               id,description,amount_cents,account_id,category_id,day_of_month,start_month
             ) VALUES('merge-rec','Mercado',-1000,'default-account','source',1,'2026-07')",
        )
        .execute(&db)
        .await
        .unwrap();

        let impact = merge_category_impl(&db, "source", "target").await.unwrap();
        assert_eq!(impact.moved_transactions, 1);
        assert_eq!(impact.moved_recurring, 1);
        assert_eq!(impact.moved_children, 1);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT category_id FROM transactions WHERE id='merge-tx'",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            "target"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT parent_id FROM categories WHERE id='child'")
                .fetch_one(&db)
                .await
                .unwrap(),
            "target"
        );
        assert!(sqlx::query_scalar::<_, Option<String>>(
            "SELECT deleted_at FROM categories WHERE id='source'",
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .is_some());
    }

    #[tokio::test]
    async fn merge_rejects_different_kinds_and_system_source() {
        let (_directory, db) = database().await;
        sqlx::query(
            "INSERT INTO categories(id,name,kind,sort_order,is_system) VALUES
             ('custom-income','Extra','income',900,0),
             ('custom-expense','Extra','expense',901,0)",
        )
        .execute(&db)
        .await
        .unwrap();

        let error = merge_category_impl(&db, "custom-income", "custom-expense")
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Validation(_)));

        let error = merge_category_impl(&db, "income", "custom-income")
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Validation(_)));
    }
}
