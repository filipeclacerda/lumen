use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::Path;
use crate::error::AppError;

pub async fn connect(path: &Path) -> Result<SqlitePool, AppError> {
    let url = format!("sqlite:{}?mode=rwc", path.display());
    let pool = SqlitePoolOptions::new().max_connections(5).connect(&url).await?;
    sqlx::query("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").execute(&pool).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    // Touched to force recompile for migrations!
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_create_seed_categories_and_rules() {
        let directory = tempfile::tempdir().unwrap();
        let pool = connect(&directory.path().join("test.db")).await.unwrap();
        let category_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL")
            .fetch_one(&pool).await.unwrap();
        let rule_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categorization_rules WHERE enabled=1")
            .fetch_one(&pool).await.unwrap();
        let profile_table: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_profiles'")
            .fetch_one(&pool).await.unwrap();
        let opening_category: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE id='opening-balance' AND kind='transfer'")
            .fetch_one(&pool).await.unwrap();
        let invoice_table: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='credit_card_invoices'")
            .fetch_one(&pool).await.unwrap();
        assert!(category_count >= 20);
        assert!(rule_count >= 9);
        assert_eq!(profile_table, 1);
        assert_eq!(opening_category, 1);
        assert_eq!(invoice_table, 1);
    }
}
