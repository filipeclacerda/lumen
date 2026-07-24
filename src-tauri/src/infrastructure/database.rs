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
const PAYMENT_SETTLEMENT_MIGRATION_VERSION: i64 = 19;
// Development builds could apply the first complete v19 snapshot while `tauri dev` was
// watching the repository. That snapshot already contains the data transformation and
// progressive-link schema, but predates the final unique invoice constraint.
const LEGACY_PAYMENT_SETTLEMENT_CHECKSUM: &[u8; 48] = &[
    0xC7, 0x34, 0x1F, 0xF4, 0x30, 0x9B, 0x7C, 0x55, 0xDE, 0xD8, 0x48, 0x57, 0x71, 0x72, 0xB7, 0x53,
    0x90, 0x83, 0x94, 0x92, 0x4B, 0x66, 0x9F, 0xC9, 0xB0, 0x7D, 0xFD, 0x63, 0x97, 0x70, 0xBC, 0xC6,
    0x0F, 0xDF, 0x2C, 0x46, 0xCE, 0x60, 0xFF, 0x71, 0x91, 0x83, 0x8A, 0x85, 0x50, 0x44, 0x23, 0x98,
];

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
    repair_v22_disabled_profile_target(pool).await?;
    repair_payment_settlement_migration(pool, &migrator).await?;
    repair_line_ending_migration_checksums(pool, &migrator).await?;
    migrator.run(pool).await?;
    Ok(())
}

async fn repair_v22_disabled_profile_target(pool: &SqlitePool) -> Result<(), AppError> {
    let migration_table: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if migration_table == 0 {
        return Ok(());
    }
    let at_v22: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version=22 AND success=1)
          AND NOT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version=23 AND success=1)",
    )
    .fetch_one(pool)
    .await?;
    if at_v22 == 0 {
        return Ok(());
    }
    sqlx::query(
        "UPDATE financial_targets
         SET kind='savings',category_id=NULL,amount_cents=(
           SELECT monthly_target_cents FROM user_profiles WHERE id='primary'
         ),enabled=1,deleted_at=NULL,updated_at=datetime('now')
         WHERE id=(
           SELECT id FROM financial_targets
           WHERE kind='savings'
           ORDER BY CASE
             WHEN deleted_at IS NULL THEN 0
             WHEN id='profile-monthly-savings' THEN 1
             ELSE 2
           END,created_at,id
           LIMIT 1
         )
           AND EXISTS(SELECT 1 FROM user_profiles
                      WHERE id='primary' AND monthly_target_cents IS NOT NULL)",
    )
    .execute(pool)
    .await?;
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
        let mut last_error = None;
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
            // Capture GetLastError immediately: later calls (including sleep) may
            // overwrite the thread-local value and turn a real failure into OS error 0.
            last_error = Some(std::io::Error::last_os_error());
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Err(last_error.expect("the retry loop always runs").into())
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
        let mut last_error = None;
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
            last_error = Some(std::io::Error::last_os_error());
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Err(last_error.expect("the retry loop always runs").into())
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
        let mut last_error = None;
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
            last_error = Some(std::io::Error::last_os_error());
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Err(last_error.expect("the retry loop always runs").into())
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

async fn validate_index_definition(
    connection: &mut SqliteConnection,
    table: &str,
    index: &str,
    unique: bool,
    columns: &[(&str, bool)],
    predicate: Option<&str>,
) -> Result<(), AppError> {
    let index_row = sqlx::query("SELECT \"unique\",partial FROM pragma_index_list(?) WHERE name=?")
        .bind(table)
        .bind(index)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(invalid_backup)?;
    if (index_row.try_get::<i64, _>("unique")? != 0) != unique
        || (index_row.try_get::<i64, _>("partial")? != 0) != predicate.is_some()
    {
        return Err(invalid_backup());
    }

    let actual_columns =
        sqlx::query("SELECT name,\"desc\" FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno")
            .bind(index)
            .fetch_all(&mut *connection)
            .await?
            .into_iter()
            .map(|row| {
                Ok((
                    row.try_get::<String, _>("name")?,
                    row.try_get::<i64, _>("desc")? != 0,
                ))
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;
    let expected_columns = columns
        .iter()
        .map(|(name, descending)| ((*name).to_string(), *descending))
        .collect::<Vec<_>>();
    if actual_columns != expected_columns {
        return Err(invalid_backup());
    }

    if let Some(expected_predicate) = predicate {
        let sql: String =
            sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
                .bind(index)
                .fetch_one(&mut *connection)
                .await?;
        let compact = sql
            .chars()
            .filter(|character| !character.is_whitespace())
            .flat_map(char::to_lowercase)
            .collect::<String>();
        let actual_predicate = compact
            .split_once("where")
            .map(|(_, value)| value)
            .ok_or_else(invalid_backup)?;
        if actual_predicate != expected_predicate {
            return Err(invalid_backup());
        }
    }
    Ok(())
}

async fn validate_column_shape(
    connection: &mut SqliteConnection,
    table: &str,
    column: &str,
    not_null: bool,
    primary_key_position: i64,
) -> Result<(), AppError> {
    let row = sqlx::query("SELECT \"notnull\",pk FROM pragma_table_info(?) WHERE name=?")
        .bind(table)
        .bind(column)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(invalid_backup)?;
    if (row.try_get::<i64, _>("notnull")? != 0) != not_null
        || row.try_get::<i64, _>("pk")? != primary_key_position
    {
        return Err(invalid_backup());
    }
    Ok(())
}

async fn validate_foreign_key(
    connection: &mut SqliteConnection,
    table: &str,
    column: &str,
    target_table: &str,
    target_column: &str,
) -> Result<(), AppError> {
    let found: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_foreign_key_list(?)
         WHERE \"from\"=? AND \"table\"=? AND \"to\"=?",
    )
    .bind(table)
    .bind(column)
    .bind(target_table)
    .bind(target_column)
    .fetch_one(&mut *connection)
    .await?;
    if found != 1 {
        return Err(invalid_backup());
    }
    Ok(())
}

fn compact_sql_expression(expression: &str) -> String {
    expression
        .chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn table_check_expressions(schema: &str) -> Result<Vec<String>, AppError> {
    let bytes = schema.as_bytes();
    let mut checks = Vec::new();
    let mut cursor = 0;
    while cursor + 5 <= bytes.len() {
        let is_check = bytes[cursor..cursor + 5].eq_ignore_ascii_case(b"check");
        let before_is_identifier =
            cursor > 0 && (bytes[cursor - 1].is_ascii_alphanumeric() || bytes[cursor - 1] == b'_');
        let after_is_identifier = cursor + 5 < bytes.len()
            && (bytes[cursor + 5].is_ascii_alphanumeric() || bytes[cursor + 5] == b'_');
        if !is_check || before_is_identifier || after_is_identifier {
            cursor += 1;
            continue;
        }

        let mut open = cursor + 5;
        while open < bytes.len() && bytes[open].is_ascii_whitespace() {
            open += 1;
        }
        if bytes.get(open) != Some(&b'(') {
            return Err(invalid_backup());
        }
        let mut depth = 1usize;
        let mut position = open + 1;
        let mut quote = None;
        while position < bytes.len() && depth > 0 {
            let byte = bytes[position];
            if let Some(delimiter) = quote {
                if byte == delimiter {
                    if bytes.get(position + 1) == Some(&delimiter) {
                        position += 2;
                        continue;
                    }
                    quote = None;
                }
            } else {
                match byte {
                    b'\'' | b'"' | b'`' => quote = Some(byte),
                    b'(' => depth += 1,
                    b')' => depth -= 1,
                    _ => {}
                }
            }
            position += 1;
        }
        if depth != 0 {
            return Err(invalid_backup());
        }
        checks.push(compact_sql_expression(&schema[open + 1..position - 1]));
        cursor = position;
    }
    Ok(checks)
}

async fn validate_table_checks(
    connection: &mut SqliteConnection,
    table: &str,
    expected: &[&str],
) -> Result<(), AppError> {
    let schema: String =
        sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
            .bind(table)
            .fetch_one(&mut *connection)
            .await?;
    let actual = table_check_expressions(&schema)?;
    if expected
        .iter()
        .map(|expression| compact_sql_expression(expression))
        .any(|expression| !actual.contains(&expression))
    {
        return Err(invalid_backup());
    }
    Ok(())
}

async fn validate_unique_columns(
    connection: &mut SqliteConnection,
    table: &str,
    expected_columns: &[&str],
) -> Result<(), AppError> {
    let indexes = sqlx::query("SELECT name,partial FROM pragma_index_list(?) WHERE \"unique\"=1")
        .bind(table)
        .fetch_all(&mut *connection)
        .await?;
    for index in indexes {
        if index.try_get::<i64, _>("partial")? != 0 {
            continue;
        }
        let name: String = index.try_get("name")?;
        let columns =
            sqlx::query("SELECT name FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno")
                .bind(name)
                .fetch_all(&mut *connection)
                .await?
                .into_iter()
                .map(|row| row.try_get::<String, _>("name"))
                .collect::<Result<Vec<_>, sqlx::Error>>()?;
        if columns
            == expected_columns
                .iter()
                .map(|column| (*column).to_string())
                .collect::<Vec<_>>()
        {
            return Ok(());
        }
    }
    Err(invalid_backup())
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
        "category_merge_log",
        "financial_targets",
        "financial_target_overrides",
        "csv_mapping_profiles",
        "recurring_transactions",
        "merchant_aliases",
        "account_balance_checkpoints",
        "installment_plans",
        "transaction_installments",
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
        ("transaction_links", "previous_credit_category_id"),
        ("transaction_links", "previous_credit_category_source"),
        ("transaction_links", "previous_credit_rule_id"),
        ("category_merge_log", "moved_targets"),
        ("category_merge_log", "archived_targets"),
        ("financial_targets", "include_descendants"),
        ("financial_targets", "is_profile_target"),
        ("account_balance_checkpoints", "as_of_date"),
        ("account_balance_checkpoints", "balance_cents"),
        ("recurring_transactions", "day_of_month"),
        ("user_profiles", "income_day_rule"),
        ("user_profiles", "monthly_target_cents"),
        ("user_profiles", "onboarding_start_mode"),
        ("_sqlx_migrations", "checksum"),
        ("installment_plans", "installment_count"),
        ("transaction_installments", "installment_number"),
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
    for (table, column, not_null, primary_key_position) in [
        ("account_balance_checkpoints", "id", false, 1),
        ("account_balance_checkpoints", "account_id", true, 0),
        ("account_balance_checkpoints", "as_of_date", true, 0),
        ("account_balance_checkpoints", "balance_cents", true, 0),
        ("account_balance_checkpoints", "source", true, 0),
        ("installment_plans", "id", false, 1),
        ("installment_plans", "account_id", true, 0),
        ("installment_plans", "first_date", true, 0),
        ("installment_plans", "description", true, 0),
        ("installment_plans", "total_cents", true, 0),
        ("installment_plans", "installment_count", true, 0),
        ("transaction_installments", "plan_id", true, 1),
        ("transaction_installments", "installment_number", true, 2),
        ("transaction_installments", "transaction_id", true, 0),
        ("transaction_installments", "installment_count", true, 0),
    ] {
        validate_column_shape(connection, table, column, not_null, primary_key_position).await?;
    }
    for (table, column, target_table, target_column) in [
        (
            "account_balance_checkpoints",
            "account_id",
            "accounts",
            "id",
        ),
        ("installment_plans", "account_id", "accounts", "id"),
        ("installment_plans", "category_id", "categories", "id"),
        (
            "transaction_installments",
            "plan_id",
            "installment_plans",
            "id",
        ),
        (
            "transaction_installments",
            "transaction_id",
            "transactions",
            "id",
        ),
    ] {
        validate_foreign_key(connection, table, column, target_table, target_column).await?;
    }
    validate_table_checks(
        connection,
        "user_profiles",
        &["monthly_target_cents IS NULL OR monthly_target_cents >= 0"],
    )
    .await?;
    validate_table_checks(
        connection,
        "account_balance_checkpoints",
        &["source IN ('manual', 'import', 'reconciliation')"],
    )
    .await?;
    validate_table_checks(
        connection,
        "installment_plans",
        &["total_cents > 0", "installment_count BETWEEN 2 AND 48"],
    )
    .await?;
    validate_table_checks(
        connection,
        "transaction_installments",
        &[
            "installment_number BETWEEN 1 AND installment_count",
            "installment_count BETWEEN 2 AND 48",
        ],
    )
    .await?;
    validate_unique_columns(connection, "transaction_installments", &["transaction_id"]).await?;

    for index in [
        "unique_external_id",
        "transaction_fingerprint",
        "transaction_date",
        "categorization_rules_priority",
        "transactions_category_source",
        "transactions_recurring",
        "transactions_merchant",
        "transaction_links_invoice",
        "category_merge_log_created_at",
        "recurring_transactions_active",
        "one_active_savings_target",
        "financial_targets_single_profile_target",
        "account_balance_checkpoints_account_date_unique",
        "account_balance_checkpoints_latest",
        "transactions_account_cleared_date",
        "installment_plans_account_date",
        "transaction_installments_plan",
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
    for index in [
        "unique_external_id",
        "one_active_savings_target",
        "financial_targets_single_profile_target",
        "account_balance_checkpoints_account_date_unique",
    ] {
        let unique: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_index_list(?) WHERE name=? AND \"unique\"=1",
        )
        .bind(match index {
            "unique_external_id" => "transactions",
            "account_balance_checkpoints_account_date_unique" => "account_balance_checkpoints",
            _ => "financial_targets",
        })
        .bind(index)
        .fetch_one(&mut *connection)
        .await?;
        if unique == 0 {
            return Err(invalid_backup());
        }
    }
    validate_index_definition(
        connection,
        "financial_targets",
        "financial_targets_single_profile_target",
        true,
        &[("is_profile_target", false)],
        Some("is_profile_target=1"),
    )
    .await?;
    validate_index_definition(
        connection,
        "category_merge_log",
        "category_merge_log_created_at",
        false,
        &[("created_at", true)],
        None,
    )
    .await?;
    validate_index_definition(
        connection,
        "account_balance_checkpoints",
        "account_balance_checkpoints_account_date_unique",
        true,
        &[("account_id", false), ("as_of_date", false)],
        None,
    )
    .await?;
    validate_index_definition(
        connection,
        "account_balance_checkpoints",
        "account_balance_checkpoints_latest",
        false,
        &[
            ("account_id", false),
            ("as_of_date", true),
            ("created_at", true),
            ("id", true),
        ],
        None,
    )
    .await?;
    validate_index_definition(
        connection,
        "transactions",
        "transactions_account_cleared_date",
        false,
        &[("account_id", false), ("date", false)],
        Some("deleted_atisnullandstatus='cleared'"),
    )
    .await?;
    validate_index_definition(
        connection,
        "installment_plans",
        "installment_plans_account_date",
        false,
        &[("account_id", false), ("first_date", false)],
        None,
    )
    .await?;
    validate_index_definition(
        connection,
        "transaction_installments",
        "transaction_installments_plan",
        false,
        &[("plan_id", false)],
        None,
    )
    .await?;
    let migrator = sqlx::migrate!("./migrations");
    let latest = migrator.iter().last().ok_or_else(invalid_backup)?;
    let applied: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=? AND success=1")
            .bind(latest.version)
            .fetch_optional(&mut *connection)
            .await?;
    if applied.as_deref() != Some(latest.checksum.as_ref())
        && line_ending_variant_checksum(latest).as_deref() != applied.as_deref()
    {
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

async fn repair_payment_settlement_migration(
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
    let applied: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=? AND success=1")
            .bind(PAYMENT_SETTLEMENT_MIGRATION_VERSION)
            .fetch_optional(pool)
            .await?;
    if applied.as_deref() != Some(LEGACY_PAYMENT_SETTLEMENT_CHECKSUM.as_slice()) {
        return Ok(());
    }
    let current = migrator
        .iter()
        .find(|migration| migration.version == PAYMENT_SETTLEMENT_MIGRATION_VERSION)
        .ok_or_else(|| AppError::Validation("Migration de pagamentos não encontrada".into()))?;

    for (table, column) in [
        ("credit_card_invoices", "payments_cents"),
        ("credit_card_invoice_items", "line_kind"),
        ("transaction_links", "previous_invoice_status"),
    ] {
        let found: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?")
                .bind(table)
                .bind(column)
                .fetch_one(pool)
                .await?;
        if found == 0 {
            return Err(AppError::Validation(
                "A migration local de pagamentos está incompleta".into(),
            ));
        }
    }
    let valid_trigger: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type='trigger' AND name='update_invoice_totals_on_transaction_update'
           AND sql LIKE '%line_kind = ''refund''%'
           AND sql LIKE '%line_kind = ''payment''%'",
    )
    .fetch_one(pool)
    .await?;
    if valid_trigger == 0 {
        return Err(AppError::Validation(
            "A migration local de pagamentos está incompleta".into(),
        ));
    }
    let duplicate_invoices: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
           SELECT invoice_id FROM transaction_links
           WHERE invoice_id IS NOT NULL
           GROUP BY invoice_id HAVING COUNT(*) > 1
         )",
    )
    .fetch_one(pool)
    .await?;
    if duplicate_invoices > 0 {
        return Err(AppError::Validation(
            "Há mais de uma conciliação para a mesma fatura".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS transaction_links_invoice
         ON transaction_links(invoice_id)",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE _sqlx_migrations SET checksum=?
         WHERE version=? AND success=1 AND checksum=?",
    )
    .bind(current.checksum.as_ref().to_vec())
    .bind(PAYMENT_SETTLEMENT_MIGRATION_VERSION)
    .bind(LEGACY_PAYMENT_SETTLEMENT_CHECKSUM.as_slice())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
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

    async fn database_at_version(path: &Path, version: i64) -> SqliteConnection {
        let mut connection = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE _sqlx_migrations(
               version BIGINT PRIMARY KEY,description TEXT NOT NULL,
               installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
               success BOOLEAN NOT NULL,checksum BLOB NOT NULL,execution_time BIGINT NOT NULL
             )",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        let migrator = sqlx::migrate!("./migrations");
        for migration in migrator
            .iter()
            .filter(|migration| migration.version <= version)
        {
            sqlx::raw_sql(migration.sql.as_ref())
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time)
                 VALUES(?,?,1,?,0)",
            )
            .bind(migration.version)
            .bind(migration.description.as_ref())
            .bind(migration.checksum.as_ref())
            .execute(&mut connection)
            .await
            .unwrap();
        }
        connection
    }

    #[tokio::test]
    async fn real_v22_upgrade_repairs_any_non_deleted_disabled_savings_target() {
        for (case, target_id, deleted_target, add_deleted_profile) in [
            ("random-disabled", "random-savings", false, false),
            ("deleted-profile", "profile-monthly-savings", true, false),
            (
                "random-disabled-with-deleted-profile",
                "random-savings",
                false,
                true,
            ),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(format!("v22-{case}.db"));
            let mut connection = database_at_version(&path, 22).await;
            sqlx::query(
                "INSERT INTO user_profiles(id,display_name,monthly_target_cents,onboarding_completed_at)
                 VALUES('primary','Pessoa',45000,datetime('now'))",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO financial_targets(id,kind,amount_cents,enabled,deleted_at)
                 VALUES(?,'savings',10000,0,CASE WHEN ? THEN datetime('now') ELSE NULL END)",
            )
            .bind(target_id)
            .bind(deleted_target)
            .execute(&mut connection)
            .await
            .unwrap();
            if add_deleted_profile {
                sqlx::query(
                    "INSERT INTO financial_targets(
                       id,kind,amount_cents,enabled,deleted_at
                     ) VALUES(
                       'profile-monthly-savings','savings',5000,0,datetime('now')
                     )",
                )
                .execute(&mut connection)
                .await
                .unwrap();
            }
            connection.close().await.unwrap();

            let pool = connect(&path).await.unwrap();
            let repaired = sqlx::query(
                "SELECT id,amount_cents,enabled,deleted_at,is_profile_target
                 FROM financial_targets WHERE is_profile_target=1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(repaired.get::<String, _>("id"), target_id);
            assert_eq!(repaired.get::<i64, _>("amount_cents"), 45_000);
            assert_eq!(repaired.get::<i64, _>("enabled"), 1);
            assert!(repaired.get::<Option<String>, _>("deleted_at").is_none());
            pool.close().await;
        }
    }

    #[tokio::test]
    async fn v26_upgrade_prefers_active_savings_and_deduplicates_checkpoints() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("v26.db");
        let mut connection = database_at_version(&path, 26).await;
        sqlx::query(
            "INSERT INTO user_profiles(id,display_name,monthly_target_cents,onboarding_completed_at)
             VALUES('primary','Pessoa',45000,datetime('now'))",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO financial_targets(
               id,kind,amount_cents,enabled,deleted_at,is_profile_target
             ) VALUES
               ('archived-marker','savings',10000,0,datetime('now'),1),
               ('active-replacement','savings',20000,1,NULL,0)",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO account_balance_checkpoints(
               id,account_id,as_of_date,balance_cents,source,created_at
             ) VALUES
               ('older','default-account','2026-01-15',1000,'manual','2026-01-15 10:00:00'),
               ('newer','default-account','2026-01-15',2000,'manual','2026-01-15 11:00:00')",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        connection.close().await.unwrap();

        upgrade_and_validate_restore(&path).await.unwrap();
        let pool = connect(&path).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT id FROM financial_targets WHERE is_profile_target=1",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "active-replacement"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT id FROM account_balance_checkpoints
                 WHERE account_id='default-account' AND as_of_date='2026-01-15'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "newer"
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn v26_upgrade_reuses_a_disabled_or_archived_savings_identity() {
        for (case, deleted_at) in [("disabled", None), ("archived", Some("2026-01-01"))] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(format!("v26-{case}.db"));
            let mut connection = database_at_version(&path, 26).await;
            sqlx::query(
                "INSERT INTO financial_targets(
                   id,kind,amount_cents,enabled,is_profile_target,deleted_at
                 ) VALUES('legacy-savings','savings',10000,0,0,?)",
            )
            .bind(deleted_at)
            .execute(&mut connection)
            .await
            .unwrap();
            connection.close().await.unwrap();

            let pool = connect(&path).await.unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT id FROM financial_targets WHERE is_profile_target=1",
                )
                .fetch_one(&pool)
                .await
                .unwrap(),
                "legacy-savings"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT \"notnull\" FROM pragma_table_info('category_merge_log')
                     WHERE name='archived_targets'",
                )
                .fetch_one(&pool)
                .await
                .unwrap(),
                1
            );
            pool.close().await;
        }
    }

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
    async fn schema_validation_rejects_adulterated_critical_index_definition() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("schema.db");
        let pool = connect(&p).await.unwrap();
        sqlx::raw_sql(
            "DROP INDEX account_balance_checkpoints_account_date_unique;
             CREATE UNIQUE INDEX account_balance_checkpoints_account_date_unique
             ON account_balance_checkpoints(as_of_date,account_id);",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut connection = pool.acquire().await.unwrap();
        assert!(validate_current_schema(&mut connection).await.is_err());
        drop(connection);
        pool.close().await;
    }

    #[tokio::test]
    async fn schema_validation_rejects_adulterated_partial_index_predicate() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("predicate.db");
        let pool = connect(&p).await.unwrap();
        sqlx::raw_sql(
            "DROP INDEX transactions_account_cleared_date;
             CREATE INDEX transactions_account_cleared_date
             ON transactions(account_id,date)
             WHERE deleted_at IS NULL;",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut connection = pool.acquire().await.unwrap();
        assert!(validate_current_schema(&mut connection).await.is_err());
        drop(connection);
        pool.close().await;
    }

    #[tokio::test]
    async fn structural_validation_rejects_missing_foreign_keys_notnull_and_target_check() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("structural.db");
        let pool = connect(&p).await.unwrap();
        let mut connection = pool.acquire().await.unwrap();
        sqlx::raw_sql(
            "CREATE TABLE malformed_checkpoint(
               id TEXT PRIMARY KEY,account_id TEXT NOT NULL,as_of_date TEXT NOT NULL,
               balance_cents INTEGER NOT NULL,source TEXT NOT NULL
             );
             CREATE TABLE malformed_installments(
               plan_id TEXT,installment_number INTEGER NOT NULL,
               transaction_id TEXT NOT NULL,installment_count INTEGER NOT NULL,
               PRIMARY KEY(plan_id,installment_number)
             );
             CREATE TABLE malformed_profile(monthly_target_cents INTEGER);",
        )
        .execute(&mut *connection)
        .await
        .unwrap();

        assert!(validate_foreign_key(
            &mut connection,
            "malformed_checkpoint",
            "account_id",
            "accounts",
            "id"
        )
        .await
        .is_err());
        assert!(validate_column_shape(
            &mut connection,
            "malformed_installments",
            "plan_id",
            true,
            1
        )
        .await
        .is_err());
        assert!(validate_table_checks(
            &mut connection,
            "malformed_profile",
            &["monthly_target_cents IS NULL OR monthly_target_cents >= 0"]
        )
        .await
        .is_err());
        drop(connection);
        pool.close().await;
    }

    #[tokio::test]
    async fn restore_validation_rejects_real_tables_with_missing_material_constraints() {
        let cases = [
            (
                "checkpoint-check.db",
                "CREATE TABLE account_balance_checkpoints_bad(
                   id TEXT PRIMARY KEY,
                   account_id TEXT NOT NULL REFERENCES accounts(id),
                   as_of_date TEXT NOT NULL,
                   balance_cents INTEGER NOT NULL,
                   source TEXT NOT NULL,
                   note TEXT,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO account_balance_checkpoints_bad
                 SELECT * FROM account_balance_checkpoints;
                 DROP TABLE account_balance_checkpoints;
                 ALTER TABLE account_balance_checkpoints_bad RENAME TO account_balance_checkpoints;
                 CREATE UNIQUE INDEX account_balance_checkpoints_account_date_unique
                   ON account_balance_checkpoints(account_id,as_of_date);
                 CREATE INDEX account_balance_checkpoints_latest
                   ON account_balance_checkpoints(account_id,as_of_date DESC,created_at DESC,id DESC);",
            ),
            (
                "plan-total-check.db",
                "CREATE TABLE installment_plans_bad(
                   id TEXT PRIMARY KEY,
                   account_id TEXT NOT NULL REFERENCES accounts(id),
                   first_date TEXT NOT NULL,
                   description TEXT NOT NULL,
                   total_cents INTEGER NOT NULL,
                   installment_count INTEGER NOT NULL CHECK(installment_count BETWEEN 2 AND 48),
                   category_id TEXT REFERENCES categories(id),
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO installment_plans_bad SELECT * FROM installment_plans;
                 DROP TABLE installment_plans;
                 ALTER TABLE installment_plans_bad RENAME TO installment_plans;
                 CREATE INDEX installment_plans_account_date
                   ON installment_plans(account_id,first_date);",
            ),
            (
                "plan-count-check.db",
                "CREATE TABLE installment_plans_bad(
                   id TEXT PRIMARY KEY,
                   account_id TEXT NOT NULL REFERENCES accounts(id),
                   first_date TEXT NOT NULL,
                   description TEXT NOT NULL,
                   total_cents INTEGER NOT NULL CHECK(total_cents > 0),
                   installment_count INTEGER NOT NULL,
                   category_id TEXT REFERENCES categories(id),
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO installment_plans_bad SELECT * FROM installment_plans;
                 DROP TABLE installment_plans;
                 ALTER TABLE installment_plans_bad RENAME TO installment_plans;
                 CREATE INDEX installment_plans_account_date
                   ON installment_plans(account_id,first_date);",
            ),
            (
                "transaction-installment-number-check.db",
                "CREATE TABLE transaction_installments_bad(
                   plan_id TEXT NOT NULL REFERENCES installment_plans(id),
                   transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
                   installment_number INTEGER NOT NULL,
                   installment_count INTEGER NOT NULL,
                   PRIMARY KEY(plan_id,installment_number),
                   CHECK(installment_count BETWEEN 2 AND 48)
                 );
                 INSERT INTO transaction_installments_bad SELECT * FROM transaction_installments;
                 DROP TABLE transaction_installments;
                 ALTER TABLE transaction_installments_bad RENAME TO transaction_installments;
                 CREATE INDEX transaction_installments_plan
                   ON transaction_installments(plan_id);",
            ),
            (
                "transaction-installment-count-check.db",
                "CREATE TABLE transaction_installments_bad(
                   plan_id TEXT NOT NULL REFERENCES installment_plans(id),
                   transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
                   installment_number INTEGER NOT NULL,
                   installment_count INTEGER NOT NULL,
                   PRIMARY KEY(plan_id,installment_number),
                   CHECK(installment_number BETWEEN 1 AND installment_count)
                 );
                 INSERT INTO transaction_installments_bad SELECT * FROM transaction_installments;
                 DROP TABLE transaction_installments;
                 ALTER TABLE transaction_installments_bad RENAME TO transaction_installments;
                 CREATE INDEX transaction_installments_plan
                   ON transaction_installments(plan_id);",
            ),
            (
                "transaction-installment-unique.db",
                "CREATE TABLE transaction_installments_bad(
                   plan_id TEXT NOT NULL REFERENCES installment_plans(id),
                   transaction_id TEXT NOT NULL REFERENCES transactions(id),
                   installment_number INTEGER NOT NULL,
                   installment_count INTEGER NOT NULL,
                   PRIMARY KEY(plan_id,installment_number),
                   CHECK(installment_number BETWEEN 1 AND installment_count),
                   CHECK(installment_count BETWEEN 2 AND 48)
                 );
                 INSERT INTO transaction_installments_bad SELECT * FROM transaction_installments;
                 DROP TABLE transaction_installments;
                 ALTER TABLE transaction_installments_bad RENAME TO transaction_installments;
                 CREATE INDEX transaction_installments_plan
                   ON transaction_installments(plan_id);",
            ),
        ];

        for (file_name, adulteration) in cases {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(file_name);
            let pool = connect(&path).await.unwrap();
            checkpoint_and_close(pool).await.unwrap();
            let mut connection = SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(&path)
                    .foreign_keys(false),
            )
            .await
            .unwrap();
            sqlx::raw_sql(adulteration)
                .execute(&mut connection)
                .await
                .unwrap();
            connection.close().await.unwrap();

            assert!(
                upgrade_and_validate_restore(&path).await.is_err(),
                "schema adulterado aceito: {file_name}"
            );
        }
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

    #[cfg(windows)]
    #[tokio::test]
    async fn rollback_recovery_preserves_live_with_latest_line_ending_checksum_variant() {
        let d = tempfile::tempdir().unwrap();
        seeded_database(&d.path().join(LIVE_DB), "live-alternate").await;
        seeded_database(&d.path().join(ROLLBACK_DB), "rollback-only").await;
        let migrator = sqlx::migrate!("./migrations");
        let latest = migrator.iter().last().unwrap();
        let alternate = line_ending_variant_checksum(latest).unwrap();
        let mut connection = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(d.path().join(LIVE_DB)),
        )
        .await
        .unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
            .bind(alternate)
            .bind(latest.version)
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();

        let reopened = connect_app_database(d.path()).await.unwrap();
        assert!(account_exists(&reopened, "live-alternate").await);
        assert!(!account_exists(&reopened, "rollback-only").await);
        assert!(!d.path().join(ROLLBACK_DB).exists());
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
