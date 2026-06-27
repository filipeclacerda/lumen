mod application;
mod commands;
mod domain;
mod error;
mod infrastructure;

use application::state::AppState;
use std::collections::HashMap;
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("diretório de dados");
            std::fs::create_dir_all(&data_dir)?;
            let db = tauri::async_runtime::block_on(infrastructure::database::connect(&data_dir.join("financa.db")))
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            app.manage(AppState { db, sessions: Mutex::new(HashMap::new()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts, commands::list_transactions, commands::dashboard_summary,
            commands::list_categories, commands::save_category, commands::archive_category,
            commands::list_rules, commands::save_rule, commands::archive_rule, commands::reorder_rules,
            commands::preview_rule, commands::preview_rules_retroactive, commands::apply_rules_retroactive,
            commands::update_transaction_category, commands::bulk_update_transaction_category,
            commands::delete_transactions, commands::restore_transactions,
            commands::preview_import, commands::set_import_candidate_category, commands::commit_import
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar Finança");
}
