use tauri::{AppHandle, Manager, State};

use crate::{application::state::AppState, error::AppError};

const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::Validation("Não foi possível localizar a pasta de dados".into()))
}

#[tauri::command]
pub async fn backup_database(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Flush the WAL into the main file so the copy is a complete snapshot.
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&state.db)
        .await?;
    let source = data_dir(&app)?.join("financa.db");
    std::fs::copy(&source, &path)?;
    Ok(())
}

#[tauri::command]
pub async fn restore_database(app: AppHandle, path: String) -> Result<(), AppError> {
    let bytes = std::fs::read(&path)?;
    if !bytes.starts_with(SQLITE_HEADER) {
        return Err(AppError::Validation(
            "O arquivo selecionado não é um backup válido do Lúmen".into(),
        ));
    }
    // Stage the file; it is swapped in on the next startup, before the pool opens,
    // to avoid corrupting the database that is currently in use.
    let staged = data_dir(&app)?.join("financa.restore");
    std::fs::write(&staged, &bytes)?;
    Ok(())
}

#[tauri::command]
pub async fn reset_database(app: AppHandle) -> Result<(), AppError> {
    // Stage a marker instead of deleting the file here: the database is currently
    // open (WAL/SHM in use), so the actual wipe happens at next startup, before
    // the connection pool opens, the same way `restore_database` stages a swap.
    let marker = data_dir(&app)?.join("financa.reset");
    std::fs::write(&marker, b"")?;
    Ok(())
}
