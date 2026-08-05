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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // WebView2 paints its own white surface before the document is available.
        // Keep the native window hidden until index.html's initial loader has loaded,
        // so the first visible frame belongs to Lumen rather than the WebView default.
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Finished
            {
                let _ = webview.window().show();
            }
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("diretório de dados");
            std::fs::create_dir_all(&data_dir)?;
            let reset_marker = data_dir.join("financa.reset");
            if reset_marker.exists() {
                for name in [
                    "financa.db",
                    "financa.db-wal",
                    "financa.db-shm",
                    "financa.restore",
                    "financa.restore.tmp",
                    "financa.db.pre-restore",
                ] {
                    match std::fs::remove_file(data_dir.join(name)) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                // Remove the marker last: a failed cleanup must be retried next startup.
                std::fs::remove_file(&reset_marker)?;
            }
            let db = tauri::async_runtime::block_on(
                infrastructure::database::connect_app_database(&data_dir),
            )
            .map_err(|e| Box::<dyn std::error::Error>::from(format!("{e:?}")))?;
            // Finish the one-time legacy PIX classification before the UI can cache merchant
            // groupings. Confirmed and newly imported rows are never revisited.
            tauri::async_runtime::block_on(commands::backfill_pending_pix_identification_impl(&db))
                .map_err(|e| Box::<dyn std::error::Error>::from(format!("{e:?}")))?;
            let db_for_backfill = db.clone();
            app.manage(AppState {
                db,
                sessions: Mutex::new(HashMap::new()),
                credit_card_sessions: Mutex::new(HashMap::new()),
                import_commit: Mutex::new(()),
                maintenance: Mutex::new(()),
            });
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    commands::backfill_merchant_keys_impl(&db_for_backfill, false).await
                {
                    eprintln!("Falha ao preencher merchant_key em segundo plano: {error}");
                }
            });
            if let Some(window) = app.get_webview_window("main") {
                // work_area excludes the taskbar, so the larger size must actually fit.
                let monitor = window.current_monitor()?.or(window.primary_monitor()?);
                if let Some(monitor) = monitor {
                    let area = monitor
                        .work_area()
                        .size
                        .to_logical::<f64>(monitor.scale_factor());
                    if area.width >= 1600.0 && area.height >= 900.0 {
                        window.set_size(tauri::LogicalSize::new(1600.0, 900.0))?;
                    }
                    // Center both sizes so the resized window stays inside the work area.
                    window.center()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_bootstrap,
            commands::get_profile,
            commands::save_profile,
            commands::complete_onboarding,
            commands::list_accounts,
            commands::create_account,
            commands::rename_account,
            commands::archive_account,
            commands::get_reconciliation_preview,
            commands::record_balance_checkpoint,
            commands::list_account_balance_summaries,
            commands::get_data_quality_review,
            commands::list_transactions,
            commands::list_transactions_page,
            commands::dashboard_summary,
            commands::create_transaction,
            commands::create_credit_card_installments,
            commands::update_transaction,
            commands::create_transfer,
            commands::get_transfer_details,
            commands::update_transfer,
            commands::unlink_transfer,
            commands::set_transfer_deleted,
            commands::detect_transfer_candidates,
            commands::link_transfer_pair,
            commands::list_categories,
            commands::save_category,
            commands::archive_category,
            commands::preview_category_merge,
            commands::merge_category,
            commands::list_rules,
            commands::save_rule,
            commands::archive_rule,
            commands::reorder_rules,
            commands::preview_rule,
            commands::preview_rules_retroactive,
            commands::apply_rules_retroactive,
            commands::update_transaction_category,
            commands::update_transaction_amount,
            commands::set_transaction_status,
            commands::bulk_update_transaction_category,
            commands::delete_transactions,
            commands::restore_transactions,
            commands::inspect_import_file,
            commands::identify_import_files,
            commands::list_csv_mapping_profiles,
            commands::save_csv_mapping_profile,
            commands::delete_csv_mapping_profile,
            commands::export_import_template,
            commands::preview_import,
            commands::get_import_preview,
            commands::update_import_candidate,
            commands::set_import_candidate_category,
            commands::set_import_candidates_category,
            commands::commit_import,
            commands::validate_import_batch,
            commands::commit_import_batch,
            commands::preview_mapped_bank_import,
            commands::detect_import_kind,
            commands::create_credit_card_account,
            commands::preview_credit_card_import,
            commands::get_credit_card_import_preview,
            commands::update_credit_card_import,
            commands::update_credit_card_import_categories,
            commands::preview_mapped_credit_card_import,
            commands::commit_credit_card_import,
            commands::list_credit_card_invoices,
            commands::list_credit_card_invoices_page,
            commands::set_invoice_status,
            commands::get_credit_card_invoice_items,
            commands::list_card_payment_reconciliations,
            commands::reconcile_card_payment,
            commands::find_invoice_payment_matches,
            commands::link_invoice_payment,
            commands::unlink_invoice_payment,
            commands::find_card_payment_matches,
            commands::link_card_payment,
            commands::unlink_card_payment,
            commands::set_credit_card_invoice_deleted,
            commands::list_financial_targets,
            commands::save_financial_target,
            commands::save_financial_target_override,
            commands::delete_financial_target,
            commands::generate_financial_report,
            commands::list_merchants_page,
            commands::category_trend,
            commands::export_transactions_csv,
            commands::export_transactions_ofx,
            commands::export_transactions_pdf,
            commands::export_financial_report_pdf,
            commands::backup_database,
            commands::restore_database,
            commands::reset_database,
            commands::list_recurring_transactions,
            commands::save_recurring_transaction,
            commands::set_recurring_transaction_active,
            commands::archive_recurring_transaction,
            commands::sync_recurring_transactions,
            commands::backfill_merchant_keys,
            commands::list_merchant_aliases,
            commands::list_merchant_options,
            commands::list_pending_pix_transactions,
            commands::identify_transaction_merchant,
            commands::save_merchant_alias,
            commands::delete_merchant_alias,
            commands::net_worth_history,
            commands::upcoming_items,
            commands::budget_overview
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar Lumen");
}
