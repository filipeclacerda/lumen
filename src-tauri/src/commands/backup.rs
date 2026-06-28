use sqlx::Row;
use tauri::{AppHandle, Manager, State};

use crate::{application::state::AppState, error::AppError};

const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir()
        .map_err(|_| AppError::Validation("Não foi possível localizar a pasta de dados".into()))
}

/// Wraps a value as a quoted CSV field (RFC 4180 style, doubling inner quotes).
fn csv_field(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// Formats integer cents as a Brazilian decimal string (e.g. -1234 -> "-12,34").
fn format_amount(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.abs();
    format!("{}{},{:02}", sign, abs / 100, abs % 100)
}

#[tauri::command]
pub async fn export_transactions_csv(path: String, state: State<'_, AppState>) -> Result<usize, AppError> {
    let rows = sqlx::query(
        "SELECT t.date,a.name account_name,t.description,COALESCE(c.name,'Sem categoria') category,t.amount_cents
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL ORDER BY t.date DESC"
    ).fetch_all(&state.db).await?;
    // BOM keeps acentos legible when opened directly in Excel.
    let mut out = String::from("\u{feff}");
    out.push_str("Data;Conta;Descrição;Categoria;Valor\r\n");
    for row in &rows {
        let date: String = row.get("date");
        let account: String = row.get("account_name");
        let description: String = row.get("description");
        let category: String = row.get("category");
        let amount: i64 = row.get("amount_cents");
        out.push_str(&format!(
            "{};{};{};{};{}\r\n",
            csv_field(&date), csv_field(&account), csv_field(&description),
            csv_field(&category), csv_field(&format_amount(amount))
        ));
    }
    std::fs::write(&path, out)?;
    Ok(rows.len())
}

#[tauri::command]
pub async fn backup_database(app: AppHandle, path: String, state: State<'_, AppState>) -> Result<(), AppError> {
    // Flush the WAL into the main file so the copy is a complete snapshot.
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&state.db).await?;
    let source = data_dir(&app)?.join("financa.db");
    std::fs::copy(&source, &path)?;
    Ok(())
}

#[tauri::command]
pub async fn restore_database(app: AppHandle, path: String) -> Result<(), AppError> {
    let bytes = std::fs::read(&path)?;
    if !bytes.starts_with(SQLITE_HEADER) {
        return Err(AppError::Validation("O arquivo selecionado não é um backup válido do Lúmen".into()));
    }
    // Stage the file; it is swapped in on the next startup, before the pool opens,
    // to avoid corrupting the database that is currently in use.
    let staged = data_dir(&app)?.join("financa.restore");
    std::fs::write(&staged, &bytes)?;
    Ok(())
}
