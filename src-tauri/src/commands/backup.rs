use crate::{
    application::state::AppState,
    error::AppError,
    infrastructure::database::{upgrade_and_validate_restore, validate_restore_source},
};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

fn data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::Validation("Não foi possível localizar a pasta de dados".into()))
}
fn normalized_path(path: &Path) -> PathBuf {
    if let Ok(path) = std::fs::canonicalize(path) {
        return path;
    }
    let parent = path.parent().and_then(|p| std::fs::canonicalize(p).ok());
    parent
        .map(|p| p.join(path.file_name().unwrap_or_default()))
        .unwrap_or_else(|| path.to_path_buf())
}
fn reject_managed_database_path(path: &Path, dir: &Path) -> Result<(), AppError> {
    let path = normalized_path(path);
    let dir = normalized_path(dir);
    let managed = [
        "financa.db",
        "financa.restore",
        "financa.restore.tmp",
        "financa.db.pre-restore",
    ];
    let is_managed = managed
        .iter()
        .map(|name| normalized_path(&dir.join(name)))
        .any(|candidate| {
            if cfg!(windows) {
                candidate
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&path.to_string_lossy())
            } else {
                candidate == path
            }
        });
    if is_managed {
        return Err(AppError::Validation(
            "Escolha um arquivo fora da pasta de dados do Lumen".into(),
        ));
    }
    Ok(())
}
fn sync_file(path: &Path) -> Result<(), AppError> {
    let file = std::fs::OpenOptions::new().read(true).open(path)?;
    file.sync_all()?;
    Ok(())
}
pub(crate) async fn create_backup_snapshot(db: &SqlitePool, temp: &Path) -> Result<(), AppError> {
    sqlx::query("VACUUM INTO ?")
        .bind(temp.to_string_lossy().to_string())
        .execute(db)
        .await?;
    Ok(())
}

fn rollback_after_sync_failure(
    old: &Path,
    destination: &Path,
    error: AppError,
) -> Result<(), AppError> {
    if old.exists() {
        crate::infrastructure::database::restore_without_backup(old, destination)?;
    }
    Err(error)
}

async fn publish_completed_file(
    temp: &Path,
    destination: &Path,
    old: &Path,
) -> Result<(), AppError> {
    crate::infrastructure::database::atomic_replace_with_backup(temp, destination, old)?;
    if let Err(error) = sync_file(destination) {
        return rollback_after_sync_failure(old, destination, error);
    }
    if old.exists() {
        std::fs::remove_file(old)?;
    }
    Ok(())
}

fn exclusive_temp_path(base: &Path, suffix: &str) -> PathBuf {
    let name = base.file_name().unwrap_or_default().to_string_lossy();
    base.with_file_name(format!(".{name}.{suffix}.{}", Uuid::new_v4()))
}

#[tauri::command]
pub async fn backup_database(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _maintenance = state.maintenance.lock().await;
    let destination = PathBuf::from(path);
    reject_managed_database_path(&destination, &data_dir(&app)?)?;
    let temp = exclusive_temp_path(&destination, "backup-tmp");
    let old = exclusive_temp_path(&destination, "backup-previous");
    let result = async {
        create_backup_snapshot(&state.db, &temp).await?;
        sync_file(&temp)?;
        validate_restore_source(&temp).await?;
        publish_completed_file(&temp, &destination, &old).await
    }
    .await;
    if result.is_err() {
        std::fs::remove_file(&temp).ok();
    }
    result
}

#[tauri::command]
pub async fn restore_database(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _maintenance = state.maintenance.lock().await;
    let dir = data_dir(&app)?;
    let source = PathBuf::from(path);
    reject_managed_database_path(&source, &dir)?;
    if !source.is_file() {
        return Err(AppError::Validation(
            "O arquivo de backup não foi encontrado".into(),
        ));
    }
    let temp = dir.join("financa.restore.tmp");
    let pending = dir.join("financa.restore");
    std::fs::remove_file(&temp).ok();
    if pending.exists() {
        return Err(AppError::Validation(
            "Já existe uma restauração preparada; reinicie o Lumen".into(),
        ));
    }
    std::fs::copy(&source, &temp)?;
    sync_file(&temp)?;
    if let Err(error) = upgrade_and_validate_restore(&temp).await {
        std::fs::remove_file(&temp).ok();
        return Err(error);
    }
    sync_file(&temp)?;
    if let Err(error) = crate::infrastructure::database::atomic_move(&temp, &pending) {
        std::fs::remove_file(&temp).ok();
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::{connect, validate_restore_source};

    #[test]
    fn sync_failure_without_old_keeps_published_file_and_error() {
        let d = tempfile::tempdir().unwrap();
        let destination = d.path().join("destination");
        let old = d.path().join("old");
        std::fs::write(&destination, b"new").unwrap();

        let result = rollback_after_sync_failure(
            &old,
            &destination,
            AppError::Validation("sync failed".into()),
        );

        assert!(result.is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert!(!old.exists());
    }

    #[tokio::test]
    async fn backup_snapshot_contains_committed_row_with_wal_active() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("live.db");
        let snapshot = directory.path().join("snapshot.db");
        let pool = connect(&source).await.unwrap();
        sqlx::query("PRAGMA wal_autocheckpoint=0")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('snapshot-row','Snapshot','cash')")
            .execute(&pool)
            .await
            .unwrap();
        let wal = source.with_file_name("live.db-wal");
        assert!(wal.exists() && std::fs::metadata(&wal).unwrap().len() > 0);

        create_backup_snapshot(&pool, &snapshot).await.unwrap();
        validate_restore_source(&snapshot).await.unwrap();
        let snapshot_pool = connect(&snapshot).await.unwrap();
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM accounts WHERE id='snapshot-row'")
                .fetch_one(&snapshot_pool)
                .await
                .unwrap();
        assert_eq!(count, 1);
        snapshot_pool.close().await;
        pool.close().await;
    }
}

#[tauri::command]
pub async fn reset_database(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let _maintenance = state.maintenance.lock().await;
    std::fs::write(data_dir(&app)?.join("financa.reset"), b"")?;
    Ok(())
}
