use crate::error::AppError;
use sha2::{Digest, Sha384};
use sqlx::migrate::{Migration, Migrator};
use sqlx::{
    sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, Connection, Row, SqliteConnection,
    SqlitePool,
};
use std::path::Path;

const LIVE_DB: &str = "financa.db";
const PENDING_RESTORE: &str = "financa.restore";
const RESTORE_TMP: &str = "financa.restore.tmp";
const ROLLBACK_DB: &str = "financa.db.pre-restore";

pub async fn connect(path: &Path) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    if let Err(error) = initialize_pool(&pool).await {
        pool.close().await;
        return Err(error);
    }
    Ok(pool)
}

async fn initialize_pool(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query("PRAGMA journal_mode=WAL").execute(pool).await?;
    sqlx::query("PRAGMA foreign_keys=ON").execute(pool).await?;
    let migrator = sqlx::migrate!("./migrations");
    repair_line_ending_migration_checksums(pool, &migrator).await?;
    migrator.run(pool).await?;
    Ok(())
}

pub async fn checkpoint_and_close(pool: SqlitePool) -> Result<(), AppError> {
    let result = async {
        let row = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(&pool)
            .await?;
        let busy: i64 = row.try_get("busy").unwrap_or(1);
        if busy != 0 {
            return Err(AppError::Validation(
                "Não foi possível concluir o backup com segurança".into(),
            ));
        }
        Ok(())
    }
    .await;
    pool.close().await;
    result
}

fn sidecars(path: &Path) -> [std::path::PathBuf; 2] {
    [
        path.with_file_name(format!(
            "{}-wal",
            path.file_name().unwrap_or_default().to_string_lossy()
        )),
        path.with_file_name(format!(
            "{}-shm",
            path.file_name().unwrap_or_default().to_string_lossy()
        )),
    ]
}
fn remove_sidecars(path: &Path) -> Result<(), AppError> {
    for p in sidecars(path) {
        remove_file_if_exists(&p)?;
    }
    Ok(())
}
fn invalid_backup() -> AppError {
    AppError::Validation("O backup é inválido ou incompatível com esta versão do Lumen".into())
}

pub(crate) fn atomic_move(source: &Path, destination: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let source_w: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination_w: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        for _ in 0..10 {
            let ok = unsafe {
                MoveFileExW(
                    source_w.as_ptr(),
                    destination_w.as_ptr(),
                    MOVEFILE_WRITE_THROUGH,
                )
            } != 0;
            if ok {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Err(std::io::Error::last_os_error().into())
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(source, destination)?;
        Ok(())
    }
}

/// Replaces `destination`, retaining its old contents in `backup` when present.
pub(crate) fn atomic_replace_with_backup(
    replacement: &Path,
    destination: &Path,
    backup: &Path,
) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACEFILE_WRITE_THROUGH,
        };
        let replacement_w: Vec<u16> = replacement
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let destination_w: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let backup_w: Vec<u16> = backup.as_os_str().encode_wide().chain(Some(0)).collect();
        for _ in 0..200 {
            let ok = unsafe {
                if destination.exists() {
                    ReplaceFileW(
                        destination_w.as_ptr(),
                        replacement_w.as_ptr(),
                        backup_w.as_ptr(),
                        REPLACEFILE_WRITE_THROUGH,
                        std::ptr::null(),
                        std::ptr::null_mut(),
                    )
                } else {
                    MoveFileExW(
                        replacement_w.as_ptr(),
                        destination_w.as_ptr(),
                        MOVEFILE_WRITE_THROUGH,
                    )
                }
            } != 0;
            if ok {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Err(std::io::Error::last_os_error().into())
    }
    #[cfg(not(windows))]
    {
        if destination.exists() {
            std::fs::rename(destination, backup)?;
        }
        if let Err(error) = std::fs::rename(replacement, destination) {
            if backup.exists() && !destination.exists() {
                std::fs::rename(backup, destination).map_err(AppError::from)?;
            }
            return Err(error.into());
        }
        Ok(())
    }
}

pub(crate) fn restore_without_backup(source: &Path, destination: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACEFILE_WRITE_THROUGH,
        };
        let source_w: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination_w: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        for _ in 0..1000 {
            let ok = unsafe {
                if destination.exists() {
                    ReplaceFileW(
                        destination_w.as_ptr(),
                        source_w.as_ptr(),
                        std::ptr::null(),
                        REPLACEFILE_WRITE_THROUGH,
                        std::ptr::null(),
                        std::ptr::null_mut(),
                    )
                } else {
                    MoveFileExW(
                        source_w.as_ptr(),
                        destination_w.as_ptr(),
                        MOVEFILE_WRITE_THROUGH,
                    )
                }
            } != 0;
            if ok {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Err(std::io::Error::last_os_error().into())
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(source, destination)?;
        Ok(())
    }
}

fn remove_file_if_exists(path: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn is_transient_cleanup_error(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::PermissionDenied || error.raw_os_error() == Some(32)
}

/// Removes a rollback after its replacement has been validated. Windows can keep a
/// recently closed SQLite handle alive briefly; in that case cleanup is deferred to
/// the next startup rather than making an already valid database unavailable.
fn cleanup_validated_rollback(path: &Path) -> Result<(), AppError> {
    for attempt in 0..200 {
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) if is_transient_cleanup_error(&error) && attempt < 199 => {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(error) if is_transient_cleanup_error(&error) => return Ok(()),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub async fn connect_app_database(data_dir: &Path) -> Result<SqlitePool, AppError> {
    std::fs::create_dir_all(data_dir)?;
    let data_dir = std::fs::canonicalize(data_dir)?;
    let live = data_dir.join(LIVE_DB);
    let pending = data_dir.join(PENDING_RESTORE);
    let tmp = data_dir.join(RESTORE_TMP);
    let rollback = data_dir.join(ROLLBACK_DB);
    if tmp.exists() && !pending.exists() && !rollback.exists() {
        remove_file_if_exists(&tmp)?;
    }
    if rollback.exists() && live.exists() {
        // Inspect the candidate without opening a writable pool: Windows must be able to
        // replace it immediately if recovery is needed.
        if validate_current_file_read_only(&live, false).await.is_err() {
            restore_without_backup(&rollback, &live)?;
        } else {
            match connect(&live).await {
                Ok(pool) => {
                    cleanup_validated_rollback(&rollback)?;
                    return Ok(pool);
                }
                Err(error) => {
                    checkpoint_file_and_close(&live).await.ok();
                    remove_sidecars(&live)?;
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    restore_without_backup(&rollback, &live)?;
                    return Err(error);
                }
            }
        }
    } else if rollback.exists() {
        restore_without_backup(&rollback, &live)?;
    }
    if pending.exists() {
        // Validate before replacing live so an invalid candidate cannot leave a Windows handle.
        if validate_restore_source(&pending).await.is_err() {
            remove_file_if_exists(&pending)?;
        } else {
            if live.exists() {
                checkpoint_file_and_close(&live).await?;
                remove_sidecars(&live)?;
            }
            if let Err(error) = atomic_replace_with_backup(&pending, &live, &rollback) {
                if !live.exists() && rollback.exists() {
                    restore_without_backup(&rollback, &live)?;
                }
                return Err(error);
            }
            if let Err(error) = validate_current_file_read_only(&live, false).await {
                remove_sidecars(&live)?;
                if rollback.exists() {
                    restore_without_backup(&rollback, &live)?;
                }
                return Err(error);
            }
            match connect(&live).await {
                Ok(pool) => {
                    cleanup_validated_rollback(&rollback)?;
                    return Ok(pool);
                }
                Err(error) => {
                    checkpoint_file_and_close(&live).await.ok();
                    remove_sidecars(&live)?;
                    if rollback.exists() {
                        restore_without_backup(&rollback, &live)?;
                    }
                    return Err(error);
                }
            }
        }
    }
    connect(&live).await
}

/// Validates a database without creating or upgrading it, and closes its sole connection.
/// This is intentionally immutable so recovery can inspect a candidate before replacement.
pub(crate) async fn validate_file_read_only(path: &Path) -> Result<(), AppError> {
    validate_file_read_only_with_options(path, true).await
}

async fn validate_current_file_read_only(path: &Path, immutable: bool) -> Result<(), AppError> {
    // A just-closed SQLx worker can finish releasing SQLite's WAL snapshot shortly
    // after `Pool::close` resolves. Let that handoff settle before opening the
    // independent read-only connection used by recovery.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .immutable(immutable)
        .create_if_missing(false);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| invalid_backup())?;
    let result = async {
        validate_integrity(&mut connection).await?;
        validate_complete_migration_history(&mut connection).await?;
        validate_current_schema(&mut connection).await
    }
    .await;
    let close_result = connection.close().await;
    result.and(close_result.map_err(|_| invalid_backup()))
}

async fn validate_file_read_only_with_options(
    path: &Path,
    immutable: bool,
) -> Result<(), AppError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .immutable(immutable)
        .create_if_missing(false);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| invalid_backup())?;
    let result = async {
        validate_integrity(&mut connection).await?;
        validate_migration_history(&mut connection).await
    }
    .await;
    let close_result = connection.close().await;
    result.and(close_result.map_err(|_| invalid_backup()))
}

async fn checkpoint_file_and_close(path: &Path) -> Result<(), AppError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false);
    let mut connection = SqliteConnection::connect_with(&options).await?;
    let result = match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .fetch_one(&mut connection)
        .await
    {
        Ok(row) if row.try_get::<i64, _>("busy").unwrap_or(1) == 0 => Ok(()),
        Ok(_) => Err(AppError::Validation(
            "Não foi possível concluir o backup com segurança".into(),
        )),
        Err(error) => Err(error.into()),
    };
    let close_result = connection.close().await.map_err(AppError::from);
    result.and(close_result)
}

pub async fn validate_restore_source(path: &Path) -> Result<(), AppError> {
    validate_file_read_only(path).await
}

pub async fn upgrade_and_validate_restore(path: &Path) -> Result<(), AppError> {
    // Old Lumen backups are valid sources even when they predate the current schema.
    validate_restore_source(path).await?;
    let pool = connect(path).await?;
    let result = async {
        let mut connection = pool.acquire().await?;
        validate_integrity(&mut connection).await?;
        validate_current_schema(&mut connection).await?;
        drop(connection);
        Ok::<(), AppError>(())
    }
    .await;
    if let Err(error) = result {
        pool.close().await;
        return Err(error);
    }
    checkpoint_and_close(pool).await
}

async fn validate_migration_history(connection: &mut SqliteConnection) -> Result<(), AppError> {
    let migrator = sqlx::migrate!("./migrations");
    let migrations: Vec<_> = migrator.iter().collect();
    if migrations.is_empty() {
        return Err(invalid_backup());
    }
    let rows =
        sqlx::query("SELECT version, checksum, success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut *connection)
            .await
            .map_err(|_| invalid_backup())?;
    if rows.is_empty() || rows.len() > migrations.len() {
        return Err(invalid_backup());
    }
    for (index, row) in rows.into_iter().enumerate() {
        let version: i64 = row.try_get("version").map_err(|_| invalid_backup())?;
        let success: i64 = row.try_get("success").map_err(|_| invalid_backup())?;
        let migration = migrations.get(index).ok_or_else(invalid_backup)?;
        if success != 1 || version != migration.version {
            return Err(invalid_backup());
        }
        let checksum: Vec<u8> = row.try_get("checksum").map_err(|_| invalid_backup())?;
        if checksum != migration.checksum.as_ref()
            && line_ending_variant_checksum(migration).as_deref() != Some(checksum.as_slice())
        {
            return Err(invalid_backup());
        }
    }
    Ok(())
}

async fn validate_complete_migration_history(
    connection: &mut SqliteConnection,
) -> Result<(), AppError> {
    validate_migration_history(connection).await?;
    let migrator = sqlx::migrate!("./migrations");
    for migration in migrator.iter() {
        let applied: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM _sqlx_migrations WHERE version=? AND success=1")
                .bind(migration.version)
                .fetch_optional(&mut *connection)
                .await
                .map_err(|_| invalid_backup())?;
        if applied != Some(1) {
            return Err(invalid_backup());
        }
    }
    Ok(())
}

async fn validate_integrity(connection: &mut SqliteConnection) -> Result<(), AppError> {
    let rows = sqlx::query("PRAGMA integrity_check")
        .fetch_all(&mut *connection)
        .await?;
    if rows.len() != 1
        || !rows[0]
            .try_get::<String, _>(0)
            .unwrap_or_default()
            .eq_ignore_ascii_case("ok")
    {
        return Err(invalid_backup());
    }
    if !sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *connection)
        .await?
        .is_empty()
    {
        return Err(invalid_backup());
    }
    Ok(())
}
async fn validate_current_schema(connection: &mut SqliteConnection) -> Result<(), AppError> {
    validate_migration_history(connection).await?;
    for table in [
        "_sqlx_migrations",
        "accounts",
        "categories",
        "import_batches",
        "transactions",
        "categorization_rules",
        "user_profiles",
        "credit_card_invoices",
        "credit_card_invoice_items",
        "transaction_links",
        "financial_targets",
        "financial_target_overrides",
        "csv_mapping_profiles",
        "recurring_transactions",
        "merchant_aliases",
    ] {
        let n: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?")
                .bind(table)
                .fetch_one(&mut *connection)
                .await?;
        if n == 0 {
            return Err(invalid_backup());
        }
    }
    let critical_columns = [
        ("accounts", "id"),
        ("accounts", "deleted_at"),
        ("transactions", "account_id"),
        ("transactions", "date"),
        ("transactions", "normalized_description"),
        ("transactions", "amount_cents"),
        ("transactions", "external_id"),
        ("transactions", "fingerprint"),
        ("transactions", "category_id"),
        ("transactions", "deleted_at"),
        ("transactions", "category_source"),
        ("transactions", "categorization_rule_id"),
        ("transactions", "merchant_key"),
        ("categories", "parent_id"),
        ("categories", "kind"),
        ("categories", "sort_order"),
        ("categories", "is_system"),
        ("categories", "deleted_at"),
        ("transaction_links", "kind"),
        ("transaction_links", "debit_transaction_id"),
        ("transaction_links", "credit_transaction_id"),
        ("transaction_links", "invoice_id"),
        ("recurring_transactions", "day_of_month"),
        ("_sqlx_migrations", "checksum"),
    ];
    for (table, column) in critical_columns {
        let found: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?")
                .bind(table)
                .bind(column)
                .fetch_one(&mut *connection)
                .await?;
        if found == 0 {
            return Err(invalid_backup());
        }
    }
    for index in [
        "unique_external_id",
        "transaction_fingerprint",
        "transaction_date",
        "categorization_rules_priority",
        "transactions_category_source",
        "transactions_recurring",
        "transactions_merchant",
        "transaction_links_invoice",
        "recurring_transactions_active",
        "one_active_savings_target",
    ] {
        let found: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?")
                .bind(index)
                .fetch_one(&mut *connection)
                .await?;
        if found == 0 {
            return Err(invalid_backup());
        }
    }
    for index in ["unique_external_id", "one_active_savings_target"] {
        let unique: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_index_list(?) WHERE name=? AND \"unique\"=1",
        )
        .bind(if index == "unique_external_id" {
            "transactions"
        } else {
            "financial_targets"
        })
        .bind(index)
        .fetch_one(&mut *connection)
        .await?;
        if unique == 0 {
            return Err(invalid_backup());
        }
    }
    let migrator = sqlx::migrate!("./migrations");
    let latest = migrator.iter().last().ok_or_else(invalid_backup)?;
    let applied: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=? AND success=1")
            .bind(latest.version)
            .fetch_optional(&mut *connection)
            .await?;
    if applied.as_deref() != Some(latest.checksum.as_ref()) {
        return Err(invalid_backup());
    }
    Ok(())
}

async fn repair_line_ending_migration_checksums(
    pool: &SqlitePool,
    migrator: &Migrator,
) -> Result<(), AppError> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if exists == 0 {
        return Ok(());
    }
    for migration in migrator.iter() {
        if let Some(alternate) = line_ending_variant_checksum(migration) {
            sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=? AND success=1 AND checksum=?").bind(migration.checksum.as_ref().to_vec()).bind(migration.version).bind(alternate).execute(pool).await?;
        }
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
        let d = tempfile::tempdir().unwrap();
        let p = connect(&d.path().join("test.db")).await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL")
            .fetch_one(&p)
            .await
            .unwrap();
        let rules: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM categorization_rules WHERE enabled=1")
                .fetch_one(&p)
                .await
                .unwrap();
        let profile: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_profiles'",
        )
        .fetch_one(&p)
        .await
        .unwrap();
        let opening: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM categories WHERE id='opening-balance' AND kind='transfer'",
        )
        .fetch_one(&p)
        .await
        .unwrap();
        let invoices: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='credit_card_invoices'",
        )
        .fetch_one(&p)
        .await
        .unwrap();
        assert!(n >= 20);
        assert!(rules >= 9);
        assert_eq!(profile, 1);
        assert_eq!(opening, 1);
        assert_eq!(invoices, 1);
    }
    #[tokio::test]
    async fn connect_repairs_line_ending_checksum_mismatches() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("checksum.db");
        let pool = connect(&path).await.unwrap();
        let migrator = sqlx::migrate!("./migrations");
        let migration = migrator.iter().find(|m| m.version == 17).unwrap();
        let alternate = line_ending_variant_checksum(migration).unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
            .bind(alternate)
            .bind(migration.version)
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let pool = connect(&path).await.unwrap();
        let checksum: Vec<u8> =
            sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=17")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(checksum, migration.checksum.as_ref());
    }
    #[tokio::test]
    async fn migration_history_rejects_empty() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("empty-history.db");
        let pool = connect(&p).await.unwrap();
        sqlx::query("DELETE FROM _sqlx_migrations")
            .execute(&pool)
            .await
            .unwrap();
        checkpoint_and_close(pool).await.unwrap();
        assert!(validate_restore_source(&p).await.is_err());
    }

    #[tokio::test]
    async fn migration_history_rejects_gapped_prefix() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("gapped-history.db");
        let pool = connect(&p).await.unwrap();
        let migrations = sqlx::migrate!("./migrations");
        let gap = migrations.iter().nth(1).unwrap().version;
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version=?")
            .bind(gap)
            .execute(&pool)
            .await
            .unwrap();
        checkpoint_and_close(pool).await.unwrap();
        assert!(validate_restore_source(&p).await.is_err());
    }

    #[tokio::test]
    async fn restore_source_accepts_compatible_previous_migration_history() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("previous.db");
        let pool = connect(&p).await.unwrap();
        let latest = sqlx::migrate!("./migrations")
            .iter()
            .last()
            .unwrap()
            .version;
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version=?")
            .bind(latest)
            .execute(&pool)
            .await
            .unwrap();
        checkpoint_and_close(pool).await.unwrap();
        validate_restore_source(&p).await.unwrap();
    }

    #[tokio::test]
    async fn restore_validation_rejects_foreign_sqlite() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("foreign.db");
        sqlx::sqlite::SqlitePoolOptions::new()
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&p)
                    .create_if_missing(true),
            )
            .await
            .unwrap()
            .close()
            .await;
        assert!(validate_restore_source(&p).await.is_err());
    }

    #[tokio::test]
    async fn schema_validation_rejects_adulterated_critical_index() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("schema.db");
        let pool = connect(&p).await.unwrap();
        sqlx::query("DROP INDEX transaction_date")
            .execute(&pool)
            .await
            .unwrap();
        let mut connection = pool.acquire().await.unwrap();
        assert!(validate_current_schema(&mut connection).await.is_err());
        drop(connection);
        pool.close().await;
    }

    #[test]
    fn atomic_replace_with_backup_replaces_destination_and_keeps_backup() {
        let d = tempfile::tempdir().unwrap();
        let destination = d.path().join("destination");
        let replacement = d.path().join("replacement");
        let backup = d.path().join("backup");
        std::fs::write(&destination, b"old").unwrap();
        std::fs::write(&replacement, b"new").unwrap();

        atomic_replace_with_backup(&replacement, &destination, &backup).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert_eq!(std::fs::read(&backup).unwrap(), b"old");
        assert!(!replacement.exists());
        restore_without_backup(&backup, &destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"old");
    }

    async fn seeded_database(path: &Path, id: &str) {
        let pool = connect(path).await.unwrap();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?, ?, 'cash')")
            .bind(id)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        checkpoint_and_close(pool).await.unwrap();
    }

    async fn account_exists(pool: &SqlitePool, id: &str) -> bool {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?)")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn invalid_pending_preserves_live_database() {
        let d = tempfile::tempdir().unwrap();
        let live = d.path().join(LIVE_DB);
        seeded_database(&live, "keep").await;
        std::fs::write(d.path().join(PENDING_RESTORE), b"not sqlite").unwrap();
        let reopened = connect_app_database(d.path()).await.unwrap();
        assert!(account_exists(&reopened, "keep").await);
        reopened.close().await;
    }

    #[tokio::test]
    async fn valid_pending_replaces_live_database() {
        let d = tempfile::tempdir().unwrap();
        seeded_database(&d.path().join(LIVE_DB), "old").await;
        seeded_database(&d.path().join(PENDING_RESTORE), "new").await;
        let reopened = connect_app_database(d.path()).await.unwrap();
        assert!(!account_exists(&reopened, "old").await);
        assert!(account_exists(&reopened, "new").await);
        assert!(!d.path().join(ROLLBACK_DB).exists());
        reopened.close().await;
    }

    #[tokio::test]
    async fn rollback_and_pending_without_live_install_pending() {
        let d = tempfile::tempdir().unwrap();
        seeded_database(&d.path().join(ROLLBACK_DB), "rollback").await;
        seeded_database(&d.path().join(PENDING_RESTORE), "new").await;
        let reopened = connect_app_database(d.path()).await.unwrap();
        assert!(account_exists(&reopened, "new").await);
        assert!(!account_exists(&reopened, "rollback").await);
        reopened.close().await;
    }

    #[tokio::test]
    async fn rollback_recovery_handles_live_and_rollback_states() {
        let valid = tempfile::tempdir().unwrap();
        seeded_database(&valid.path().join(LIVE_DB), "live").await;
        std::fs::copy(valid.path().join(LIVE_DB), valid.path().join(ROLLBACK_DB)).unwrap();
        let reopened = connect_app_database(valid.path()).await.unwrap();
        assert!(account_exists(&reopened, "live").await);
        assert!(!valid.path().join(ROLLBACK_DB).exists());
        reopened.close().await;

        let invalid = tempfile::tempdir().unwrap();
        seeded_database(&invalid.path().join(LIVE_DB), "invalid").await;
        std::fs::copy(
            invalid.path().join(LIVE_DB),
            invalid.path().join(ROLLBACK_DB),
        )
        .unwrap();
        let live = invalid.path().join(LIVE_DB);
        let pool = connect(&live).await.unwrap();
        sqlx::query("DROP INDEX transaction_date")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let reopened = connect_app_database(invalid.path()).await.unwrap();
        assert!(account_exists(&reopened, "invalid").await);
        let index_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='transaction_date'",
        )
        .fetch_one(&reopened)
        .await
        .unwrap();
        assert_eq!(index_count, 1);
        reopened.close().await;
    }

    #[tokio::test]
    async fn rollback_alone_becomes_live() {
        let d = tempfile::tempdir().unwrap();
        seeded_database(&d.path().join(ROLLBACK_DB), "rollback").await;
        let reopened = connect_app_database(d.path()).await.unwrap();
        assert!(account_exists(&reopened, "rollback").await);
        assert!(!d.path().join(ROLLBACK_DB).exists());
        reopened.close().await;
    }
}
