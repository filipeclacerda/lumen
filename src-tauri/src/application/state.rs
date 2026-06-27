use std::collections::HashMap;
use tokio::sync::Mutex;
use sqlx::SqlitePool;
use crate::domain::import::ImportCandidate;

pub struct ImportSession { pub account_id: String, pub file_name: String, pub candidates: Vec<ImportCandidate> }
pub struct AppState { pub db: SqlitePool, pub sessions: Mutex<HashMap<String, ImportSession>> }
