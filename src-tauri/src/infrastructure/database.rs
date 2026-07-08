use crate::error::AppError;
use sha2::{Digest, Sha384};
use sqlx::migrate::{Migration, Migrator};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::Path;

pub async fn connect(path: &Path) -> Result<SqlitePool, AppError> {
    let url = format!("sqlite:{}?mode=rwc", path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await?;
    sqlx::query("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    let migrator = sqlx::migrate!("./migrations");
    repair_line_ending_migration_checksums(&pool, &migrator).await?;
    migrator.run(&pool).await?;
    // Touched to force recompile for migrations! (0017_transaction_links_transfer_kind)
    Ok(pool)
}

async fn repair_line_ending_migration_checksums(
    pool: &SqlitePool,
    migrator: &Migrator,
) -> Result<(), AppError> {
    let migrations_table_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if migrations_table_exists == 0 {
        return Ok(());
    }

    for migration in migrator.iter() {
        let Some(alternate_checksum) = line_ending_variant_checksum(migration) else {
            continue;
        };
        sqlx::query(
            "UPDATE _sqlx_migrations
             SET checksum = ?
             WHERE version = ? AND success = 1 AND checksum = ?",
        )
        .bind(migration.checksum.as_ref().to_vec())
        .bind(migration.version)
        .bind(alternate_checksum)
        .execute(pool)
        .await?;
    }

    Ok(())
}

fn line_ending_variant_checksum(migration: &Migration) -> Option<Vec<u8>> {
    let sql = migration.sql.as_ref();
    let alternate_sql = if sql.contains("\r\n") {
        sql.replace("\r\n", "\n")
    } else if sql.contains('\n') {
        sql.replace('\n', "\r\n")
    } else {
        return None;
    };
    let checksum = Sha384::digest(alternate_sql.as_bytes()).to_vec();
    (checksum != migration.checksum.as_ref()).then_some(checksum)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_create_seed_categories_and_rules() {
        let directory = tempfile::tempdir().unwrap();
        let pool = connect(&directory.path().join("test.db")).await.unwrap();
        let category_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        let rule_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM categorization_rules WHERE enabled=1")
                .fetch_one(&pool)
                .await
                .unwrap();
        let profile_table: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_profiles'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let opening_category: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM categories WHERE id='opening-balance' AND kind='transfer'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let invoice_table: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='credit_card_invoices'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(category_count >= 20);
        assert!(rule_count >= 9);
        assert_eq!(profile_table, 1);
        assert_eq!(opening_category, 1);
        assert_eq!(invoice_table, 1);
    }

    #[tokio::test]
    async fn connect_repairs_line_ending_checksum_mismatches() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.db");
        let pool = connect(&path).await.unwrap();
        let migrator = sqlx::migrate!("./migrations");
        let migration = migrator
            .iter()
            .find(|migration| migration.version == 17)
            .expect("migration 17");
        let alternate_checksum =
            line_ending_variant_checksum(migration).expect("alternate checksum");

        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(alternate_checksum)
            .bind(migration.version)
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let pool = connect(&path).await.unwrap();
        let checksum: Vec<u8> =
            sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = 17")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(checksum, migration.checksum.as_ref());
    }
}
