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
            let db_path = data_dir.join("financa.db");
            // A restore staged by `restore_database` is swapped in here, before any
            // connection opens, so the live database is never overwritten in place.
            let staged = data_dir.join("financa.restore");
            if staged.exists() {
                let _ = std::fs::remove_file(data_dir.join("financa.db-wal"));
                let _ = std::fs::remove_file(data_dir.join("financa.db-shm"));
                std::fs::rename(&staged, &db_path)?;
            }
            let db = tauri::async_runtime::block_on(infrastructure::database::connect(&db_path))
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            app.manage(AppState {
                db,
                sessions: Mutex::new(HashMap::new()),
                credit_card_sessions: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_bootstrap, commands::get_profile, commands::save_profile,
            commands::complete_onboarding,
            commands::list_accounts, commands::create_account, commands::rename_account,
            commands::archive_account,
            commands::list_transactions, commands::dashboard_summary,
            commands::create_transaction, commands::update_transaction,
            commands::list_categories, commands::save_category, commands::archive_category,
            commands::list_rules, commands::save_rule, commands::archive_rule, commands::reorder_rules,
            commands::preview_rule, commands::preview_rules_retroactive, commands::apply_rules_retroactive,
            commands::update_transaction_category, commands::update_transaction_amount,
            commands::bulk_update_transaction_category,
            commands::delete_transactions, commands::restore_transactions,
            commands::inspect_import_file, commands::list_csv_mapping_profiles,
            commands::save_csv_mapping_profile, commands::delete_csv_mapping_profile,
            commands::export_import_template,
            commands::preview_import, commands::update_import_candidate,
            commands::set_import_candidate_category, commands::commit_import,
            commands::preview_mapped_bank_import,
            commands::detect_import_kind, commands::create_credit_card_account,
            commands::preview_credit_card_import, commands::update_credit_card_import,
            commands::preview_mapped_credit_card_import,
            commands::commit_credit_card_import, commands::list_credit_card_invoices, commands::set_invoice_status,
            commands::get_credit_card_invoice_items, commands::find_invoice_payment_matches,
            commands::link_invoice_payment, commands::unlink_invoice_payment,
            commands::find_card_payment_matches, commands::link_card_payment, commands::unlink_card_payment,
            commands::set_credit_card_invoice_deleted,
            commands::list_financial_targets, commands::save_financial_target,
            commands::save_financial_target_override, commands::delete_financial_target,
            commands::generate_financial_report,
            commands::export_transactions_csv, commands::backup_database, commands::restore_database
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar Lúmen");
}
