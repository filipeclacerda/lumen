use crate::domain::credit_card::CreditCardImportItem;
use crate::domain::import::ImportCandidate;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct ImportSession {
    pub account_id: String,
    pub file_name: String,
    pub candidates: Vec<ImportCandidate>,
}
#[derive(Clone)]
pub struct CreditCardImportSession {
    pub account_id: String,
    pub file_name: String,
    pub due_date: String,
    pub items: Vec<CreditCardImportItem>,
}
pub struct AppState {
    pub db: SqlitePool,
    pub sessions: Mutex<HashMap<String, ImportSession>>,
    pub credit_card_sessions: Mutex<HashMap<String, CreditCardImportSession>>,
    pub import_commit: Mutex<()>,
    pub maintenance: Mutex<()>,
}
