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
    archived_targets: i64,
    moved_children: i64,
    #[serde(skip)]
    source_kind: String,
    #[serde(skip)]
    target_kind: String,
    #[serde(skip)]
    source_is_system: i64,
    #[serde(skip)]
    target_is_system: i64,
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
    let target =
        sqlx::query("SELECT name,kind,is_system FROM categories WHERE id=? AND deleted_at IS NULL")
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
    let target_in_source_subtree: i64 = sqlx::query_scalar(
        "WITH RECURSIVE descendants(id) AS (
           SELECT id FROM categories WHERE parent_id=? AND deleted_at IS NULL
           UNION ALL
           SELECT c.id FROM categories c JOIN descendants d ON c.parent_id=d.id
           WHERE c.deleted_at IS NULL
         ) SELECT COUNT(*) FROM descendants WHERE id=?",
    )
    .bind(source_category_id)
    .bind(target_category_id)
    .fetch_one(db)
    .await?;
    if target_in_source_subtree != 0 {
        return Err(AppError::Validation(
            "A categoria de destino não pode estar dentro da origem".into(),
        ));
    }

    async fn count(db: &SqlitePool, sql: &str, id: &str) -> Result<i64, AppError> {
        Ok(sqlx::query_scalar::<_, i64>(sql)
            .bind(id)
            .fetch_one(db)
            .await?)
    }

    let source_targets = count(
        db,
        "SELECT COUNT(*) FROM financial_targets WHERE category_id=? AND deleted_at IS NULL",
        source_category_id,
    )
    .await?;
    let target_has_budget = count(
        db,
        "SELECT COUNT(*) FROM financial_targets WHERE category_id=? AND deleted_at IS NULL",
        target_category_id,
    )
    .await?
        > 0;

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
        moved_targets: if target_has_budget { 0 } else { source_targets },
        archived_targets: if target_has_budget { source_targets } else { 0 },
        moved_children: count(
            db,
            "SELECT COUNT(*) FROM categories WHERE parent_id=? AND deleted_at IS NULL",
            source_category_id,
        )
        .await?,
        source_kind,
        target_kind,
        source_is_system: source.get("is_system"),
        target_is_system: target.get("is_system"),
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
    merge_category_with_precondition_impl(db, impact).await
}

async fn merge_category_with_precondition_impl(
    db: &SqlitePool,
    mut impact: CategoryMergeImpact,
) -> Result<CategoryMergeImpact, AppError> {
    let source_id = impact.source_category_id.clone();
    let target_id = impact.target_category_id.clone();
    let source_category_id = source_id.as_str();
    let target_category_id = target_id.as_str();
    let mut tx = db.begin().await?;
    let current_source =
        sqlx::query("SELECT kind,is_system FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(source_category_id)
            .fetch_optional(&mut *tx)
            .await?;
    let current_target =
        sqlx::query("SELECT kind,is_system FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(target_category_id)
            .fetch_optional(&mut *tx)
            .await?;
    let precondition_matches = current_source.as_ref().is_some_and(|row| {
        row.get::<String, _>("kind") == impact.source_kind
            && row.get::<i64, _>("is_system") == impact.source_is_system
    }) && current_target.as_ref().is_some_and(|row| {
        row.get::<String, _>("kind") == impact.target_kind
            && row.get::<i64, _>("is_system") == impact.target_is_system
    });
    if !precondition_matches {
        return Err(AppError::Validation(
            "As categorias mudaram desde a prévia; revise a união".into(),
        ));
    }
    let target_in_source_subtree: i64 = sqlx::query_scalar(
        "WITH RECURSIVE descendants(id) AS (
           SELECT id FROM categories WHERE parent_id=? AND deleted_at IS NULL
           UNION ALL SELECT c.id FROM categories c JOIN descendants d ON c.parent_id=d.id
           WHERE c.deleted_at IS NULL
         ) SELECT COUNT(*) FROM descendants WHERE id=?",
    )
    .bind(source_category_id)
    .bind(target_category_id)
    .fetch_one(&mut *tx)
    .await?;
    if target_in_source_subtree != 0 {
        return Err(AppError::Validation(
            "A categoria de destino não pode estar dentro da origem".into(),
        ));
    }
    impact.moved_transactions =
        sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE category_id=?")
            .bind(source_category_id)
            .fetch_one(&mut *tx)
            .await?;
    impact.moved_rules = sqlx::query_scalar(
        "SELECT COUNT(*) FROM categorization_rules WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(source_category_id)
    .fetch_one(&mut *tx)
    .await?;
    impact.moved_recurring = sqlx::query_scalar(
        "SELECT COUNT(*) FROM recurring_transactions WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(source_category_id)
    .fetch_one(&mut *tx)
    .await?;
    impact.moved_children = sqlx::query_scalar(
        "SELECT COUNT(*) FROM categories WHERE parent_id=? AND deleted_at IS NULL",
    )
    .bind(source_category_id)
    .fetch_one(&mut *tx)
    .await?;

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
    sqlx::query("UPDATE installment_plans SET category_id=? WHERE category_id=?")
        .bind(target_category_id)
        .bind(source_category_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE transaction_links SET previous_category_id=? WHERE previous_category_id=?")
        .bind(target_category_id)
        .bind(source_category_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE transaction_links SET previous_credit_category_id=?
         WHERE previous_credit_category_id=?",
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
    let current_source_targets: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM financial_targets WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(source_category_id)
    .fetch_one(&mut *tx)
    .await?;
    impact.moved_targets = if target_has_budget {
        0
    } else {
        current_source_targets
    };
    impact.archived_targets = if target_has_budget {
        current_source_targets
    } else {
        0
    };
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
           moved_transactions,moved_rules,moved_recurring,moved_targets,archived_targets,moved_children
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
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
    .bind(impact.archived_targets)
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
        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,amount_cents,fingerprint,category_id
             ) VALUES('merge-credit','default-account','2026-07-01','Crédito','CREDITO',1000,'merge-credit-fp','source')",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_links(
               id,kind,debit_transaction_id,credit_transaction_id,
               previous_category_id,previous_credit_category_id
             ) VALUES('merge-link','transfer','merge-tx','merge-credit','source','source')",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO installment_plans(
               id,account_id,first_date,description,total_cents,installment_count,category_id
             ) VALUES('merge-plan','default-account','2026-07-01','Compra',1000,2,'source')",
        )
        .execute(&db)
        .await
        .unwrap();

        let impact = merge_category_impl(&db, "source", "target").await.unwrap();
        assert_eq!(impact.moved_transactions, 2);
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
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT category_id FROM installment_plans WHERE id='merge-plan'",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            "target"
        );
        let restored_categories = sqlx::query(
            "SELECT previous_category_id,previous_credit_category_id
             FROM transaction_links WHERE id='merge-link'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(
            restored_categories.get::<String, _>("previous_category_id"),
            "target"
        );
        assert_eq!(
            restored_categories.get::<String, _>("previous_credit_category_id"),
            "target"
        );
        crate::commands::unlink_transfer_impl("merge-tx", &db)
            .await
            .unwrap();
        for id in ["merge-tx", "merge-credit"] {
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT category_id FROM transactions WHERE id=?",)
                    .bind(id)
                    .fetch_one(&db)
                    .await
                    .unwrap(),
                "target"
            );
        }
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

    #[tokio::test]
    async fn rejects_descendant_target_and_reports_archived_budget_conflicts() {
        let (_directory, db) = database().await;
        sqlx::query(
            "INSERT INTO categories(id,parent_id,name,kind,is_system) VALUES
             ('source',NULL,'Origem','expense',0),
             ('child','source','Filha','expense',0),
             ('target',NULL,'Destino','expense',0)",
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(matches!(
            merge_category_impl(&db, "source", "child").await,
            Err(AppError::Validation(_))
        ));
        sqlx::query(
            "INSERT INTO financial_targets(id,kind,category_id,amount_cents) VALUES
             ('source-budget','category','source',1000),
             ('target-budget','category','target',2000)",
        )
        .execute(&db)
        .await
        .unwrap();
        let preview = load_merge_impact(&db, "source", "target").await.unwrap();
        assert_eq!(preview.moved_targets, 0);
        assert_eq!(preview.archived_targets, 1);
        merge_category_with_precondition_impl(&db, preview)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT archived_targets FROM category_merge_log ORDER BY created_at DESC LIMIT 1",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn merge_rechecks_kind_and_system_preconditions_inside_transaction() {
        let (_directory, db) = database().await;
        sqlx::query(
            "INSERT INTO categories(id,name,kind,sort_order,is_system) VALUES
             ('source-precondition','Origem','expense',900,0),
             ('target-precondition','Destino','expense',901,0)",
        )
        .execute(&db)
        .await
        .unwrap();
        let preview = load_merge_impact(&db, "source-precondition", "target-precondition")
            .await
            .unwrap();
        sqlx::query(
            "UPDATE categories SET kind='income',is_system=1 WHERE id='source-precondition'",
        )
        .execute(&db)
        .await
        .unwrap();

        assert!(matches!(
            merge_category_with_precondition_impl(&db, preview).await,
            Err(AppError::Validation(message)) if message.contains("mudaram desde a prévia")
        ));
        assert!(sqlx::query_scalar::<_, Option<String>>(
            "SELECT deleted_at FROM categories WHERE id='source-precondition'",
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .is_none());
    }
}
