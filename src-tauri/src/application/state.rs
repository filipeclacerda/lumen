use std::collections::HashMap;
use tokio::sync::Mutex;
use sqlx::SqlitePool;
use crate::domain::import::ImportCandidate;
use crate::domain::credit_card::CreditCardImportItem;

pub struct ImportSession { pub account_id: String, pub file_name: String, pub candidates: Vec<ImportCandidate> }
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
}
