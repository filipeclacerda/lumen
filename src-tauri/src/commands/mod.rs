use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

use crate::{
    application::state::{AppState, ImportSession},
    domain::{
        categorization::{first_match, CategorizationInput, CategorizationRule, MovementType, RuleOperator},
        import::{fingerprint, ImportCandidate},
    },
    error::AppError,
    infrastructure::importer::parse_file,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account { id: String, name: String, kind: String, balance_in_cents: i64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    id: String, account_id: String, date: String, description: String,
    amount_in_cents: i64, category_id: Option<String>, category: Option<String>,
    category_source: Option<String>, status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    income_in_cents: i64, expenses_in_cents: i64, balance_in_cents: i64,
    transaction_count: i64, by_category: Vec<CategoryTotal>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal { category: String, amount_in_cents: i64 }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    id: String, parent_id: Option<String>, name: String, color: Option<String>,
    icon: Option<String>, kind: String, sort_order: i64, is_system: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    id: Option<String>, parent_id: Option<String>, name: String, color: Option<String>,
    icon: Option<String>, kind: String, sort_order: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleInput {
    id: Option<String>, name: String, priority: i64, enabled: bool, operator: RuleOperator,
    pattern: String, account_id: Option<String>, movement_type: MovementType,
    min_amount_in_cents: Option<i64>, max_amount_in_cents: Option<i64>, category_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleImpactItem {
    transaction_id: String, date: String, description: String,
    current_category: Option<String>, suggested_category: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleImpact { count: usize, sample: Vec<RuleImpactItem> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview { session_id: String, file_name: String, candidates: Vec<ImportCandidate> }

fn operator_from(value: &str) -> RuleOperator {
    match value { "starts_with" => RuleOperator::StartsWith, "regex" => RuleOperator::Regex, _ => RuleOperator::Contains }
}

fn movement_from(value: &str) -> MovementType {
    match value { "income" => MovementType::Income, "expense" => MovementType::Expense, "transfer" => MovementType::Transfer, _ => MovementType::Any }
}

fn operator_str(value: &RuleOperator) -> &'static str {
    match value { RuleOperator::Contains => "contains", RuleOperator::StartsWith => "starts_with", RuleOperator::Regex => "regex" }
}

fn movement_str(value: &MovementType) -> &'static str {
    match value { MovementType::Any => "any", MovementType::Income => "income", MovementType::Expense => "expense", MovementType::Transfer => "transfer" }
}

fn rule_from_row(row: SqliteRow) -> CategorizationRule {
    CategorizationRule {
        id: row.get("id"), name: row.get("name"), priority: row.get("priority"),
        enabled: row.get::<i64, _>("enabled") != 0, operator: operator_from(row.get("operator")),
        pattern: row.get("pattern"), account_id: row.get("account_id"),
        movement_type: movement_from(row.get("movement_type")),
        min_amount_in_cents: row.get("min_amount_cents"), max_amount_in_cents: row.get("max_amount_cents"),
        category_id: row.get("category_id"), category_name: row.get("category_name"),
        use_count: row.get("use_count"), is_system: row.get::<i64, _>("is_system") != 0,
    }
}

async fn load_rules(db: &SqlitePool) -> Result<Vec<CategorizationRule>, AppError> {
    let rows = sqlx::query(
        "SELECT r.*, c.name category_name FROM categorization_rules r
         JOIN categories c ON c.id=r.category_id
         WHERE r.deleted_at IS NULL ORDER BY r.priority, r.created_at"
    ).fetch_all(db).await?;
    Ok(rows.into_iter().map(rule_from_row).collect())
}

fn validate_rule(input: &RuleInput) -> Result<(), AppError> {
    if input.name.trim().is_empty() || input.pattern.trim().is_empty() {
        return Err(AppError::Validation("Nome e padrão da regra são obrigatórios".into()));
    }
    if input.min_amount_in_cents.zip(input.max_amount_in_cents).is_some_and(|(min, max)| min > max) {
        return Err(AppError::Validation("O valor mínimo não pode superar o máximo".into()));
    }
    if input.operator == RuleOperator::Regex {
        Regex::new(&input.pattern).map_err(|_| AppError::Validation("Expressão regular inválida".into()))?;
    }
    Ok(())
}

fn normalize_transaction_ids(ids: Vec<String>) -> Result<Vec<String>, AppError> {
    if ids.is_empty() {
        return Err(AppError::Validation("Selecione ao menos uma transação".into()));
    }
    if ids.len() > 1000 {
        return Err(AppError::Validation("Uma ação em massa aceita no máximo 1.000 transações".into()));
    }
    let mut seen = HashSet::new();
    let normalized: Vec<String> = ids.into_iter()
        .filter(|id| !id.trim().is_empty() && seen.insert(id.clone()))
        .collect();
    if normalized.is_empty() {
        return Err(AppError::Validation("Nenhum identificador de transação válido".into()));
    }
    Ok(normalized)
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, AppError> {
    let rows = sqlx::query("SELECT id,name,kind,(SELECT COALESCE(SUM(amount_cents),0) FROM transactions t WHERE t.account_id=a.id AND t.deleted_at IS NULL) balance FROM accounts a WHERE deleted_at IS NULL ORDER BY name").fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| Account { id:r.get("id"), name:r.get("name"), kind:r.get("kind"), balance_in_cents:r.get("balance") }).collect())
}

#[tauri::command]
pub async fn list_transactions(state: State<'_, AppState>) -> Result<Vec<Transaction>, AppError> {
    let rows = sqlx::query(
        "SELECT t.id,t.account_id,t.date,t.description,t.amount_cents,t.category_id,
         COALESCE(c.name,'Sem categoria') category,t.category_source,t.status
         FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL ORDER BY date DESC LIMIT 500"
    ).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| Transaction {
        id:r.get("id"), account_id:r.get("account_id"), date:r.get("date"),
        description:r.get("description"), amount_in_cents:r.get("amount_cents"),
        category_id:r.get("category_id"), category:r.get("category"),
        category_source:r.get("category_source"), status:r.get("status"),
    }).collect())
}

#[tauri::command]
pub async fn dashboard_summary(state: State<'_, AppState>) -> Result<Summary, AppError> {
    let r = sqlx::query(
        "SELECT
         COALESCE(SUM(CASE WHEN t.amount_cents>0 AND COALESCE(c.kind,'income')!='transfer' THEN t.amount_cents ELSE 0 END),0) income,
         COALESCE(-SUM(CASE WHEN t.amount_cents<0 AND COALESCE(c.kind,'expense')!='transfer' THEN t.amount_cents ELSE 0 END),0) expenses,
         COALESCE(SUM(t.amount_cents),0) balance, COUNT(*) count
         FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.deleted_at IS NULL"
    ).fetch_one(&state.db).await?;
    let cats = sqlx::query(
        "SELECT COALESCE(c.name,'Sem categoria') category,-SUM(t.amount_cents) amount
         FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.amount_cents<0 AND t.deleted_at IS NULL AND COALESCE(c.kind,'expense')!='transfer'
         GROUP BY category ORDER BY amount DESC LIMIT 6"
    ).fetch_all(&state.db).await?;
    Ok(Summary {
        income_in_cents:r.get("income"), expenses_in_cents:r.get("expenses"),
        balance_in_cents:r.get("balance"), transaction_count:r.get("count"),
        by_category:cats.into_iter().map(|x|CategoryTotal{category:x.get("category"),amount_in_cents:x.get("amount")}).collect(),
    })
}

#[tauri::command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, AppError> {
    let rows = sqlx::query("SELECT id,parent_id,name,color,icon,kind,sort_order,is_system FROM categories WHERE deleted_at IS NULL ORDER BY sort_order,name").fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| Category {
        id:r.get("id"),parent_id:r.get("parent_id"),name:r.get("name"),color:r.get("color"),
        icon:r.get("icon"),kind:r.get("kind"),sort_order:r.get("sort_order"),is_system:r.get::<i64,_>("is_system")!=0,
    }).collect())
}

#[tauri::command]
pub async fn save_category(input: CategoryInput, state: State<'_, AppState>) -> Result<String, AppError> {
    if input.name.trim().is_empty() || !["income","expense","transfer"].contains(&input.kind.as_str()) {
        return Err(AppError::Validation("Nome e tipo válidos são obrigatórios".into()));
    }
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    if input.parent_id.as_deref() == Some(&id) {
        return Err(AppError::Validation("Uma categoria não pode ser superior de si mesma".into()));
    }
    if let Some(parent_id) = &input.parent_id {
        let parent_kind = sqlx::query_scalar::<_,String>("SELECT kind FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(parent_id).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::Validation("Categoria superior não encontrada".into()))?;
        if parent_kind != input.kind {
            return Err(AppError::Validation("Categoria e categoria superior precisam ter o mesmo tipo".into()));
        }
        let creates_cycle = sqlx::query_scalar::<_,i64>(
            "WITH RECURSIVE ancestors(id,parent_id) AS (
             SELECT id,parent_id FROM categories WHERE id=?
             UNION ALL SELECT c.id,c.parent_id FROM categories c JOIN ancestors a ON c.id=a.parent_id
             ) SELECT COUNT(*) FROM ancestors WHERE id=?"
        ).bind(parent_id).bind(&id).fetch_one(&state.db).await? > 0;
        if creates_cycle { return Err(AppError::Validation("A hierarquia escolhida criaria um ciclo".into())); }
    }
    sqlx::query(
        "INSERT INTO categories(id,parent_id,name,color,icon,kind,sort_order,is_system)
         VALUES(?,?,?,?,?,?,?,0)
         ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,color=excluded.color,
         icon=excluded.icon,kind=excluded.kind,sort_order=excluded.sort_order"
    ).bind(&id).bind(input.parent_id).bind(input.name.trim()).bind(input.color).bind(input.icon)
        .bind(input.kind).bind(input.sort_order.unwrap_or(0)).execute(&state.db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn archive_category(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let used_by_transactions = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM transactions WHERE category_id=? AND deleted_at IS NULL").bind(&id).fetch_one(&state.db).await? > 0;
    let used_by_rules = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM categorization_rules WHERE category_id=? AND deleted_at IS NULL").bind(&id).fetch_one(&state.db).await? > 0;
    if used_by_transactions || used_by_rules {
        return Err(AppError::Validation("A categoria está em uso; recategorize as transações antes de arquivá-la".into()));
    }
    sqlx::query("UPDATE categories SET deleted_at=datetime('now') WHERE id=?").bind(id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_rules(state: State<'_, AppState>) -> Result<Vec<CategorizationRule>, AppError> {
    load_rules(&state.db).await
}

#[tauri::command]
pub async fn save_rule(input: RuleInput, state: State<'_, AppState>) -> Result<String, AppError> {
    validate_rule(&input)?;
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO categorization_rules(id,name,priority,enabled,operator,pattern,account_id,movement_type,min_amount_cents,max_amount_cents,category_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,priority=excluded.priority,enabled=excluded.enabled,
         operator=excluded.operator,pattern=excluded.pattern,account_id=excluded.account_id,
         movement_type=excluded.movement_type,min_amount_cents=excluded.min_amount_cents,
         max_amount_cents=excluded.max_amount_cents,category_id=excluded.category_id,updated_at=datetime('now')"
    ).bind(&id).bind(input.name.trim()).bind(input.priority).bind(input.enabled as i64)
        .bind(operator_str(&input.operator)).bind(input.pattern.trim()).bind(input.account_id)
        .bind(movement_str(&input.movement_type)).bind(input.min_amount_in_cents)
        .bind(input.max_amount_in_cents).bind(input.category_id).execute(&state.db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn archive_rule(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    sqlx::query("UPDATE categorization_rules SET deleted_at=datetime('now'),enabled=0 WHERE id=?").bind(id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn reorder_rules(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    for (index, id) in ids.into_iter().enumerate() {
        sqlx::query("UPDATE categorization_rules SET priority=?,updated_at=datetime('now') WHERE id=?")
            .bind((index as i64 + 1) * 10).bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn calculate_impact(db: &SqlitePool, rule: &CategorizationRule, overwrite_manual: bool) -> Result<RuleImpact, AppError> {
    let rows = sqlx::query(
        "SELECT t.id,t.account_id,t.date,t.description,t.normalized_description,t.amount_cents,t.category_source,c.name current_category
         FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.deleted_at IS NULL"
    ).fetch_all(db).await?;
    let mut sample = Vec::new();
    let mut count = 0;
    for row in rows {
        if !overwrite_manual && row.get::<Option<String>,_>("category_source").as_deref() == Some("manual") { continue; }
        let account_id: String = row.get("account_id");
        let description: String = row.get("normalized_description");
        if crate::domain::categorization::matches_rule(rule, &CategorizationInput {
            account_id:&account_id, normalized_description:&description, amount_in_cents:row.get("amount_cents"),
        }) {
            count += 1;
            if sample.len() < 10 {
                sample.push(RuleImpactItem {
                    transaction_id:row.get("id"),date:row.get("date"),description:row.get("description"),
                    current_category:row.get("current_category"),
                    suggested_category:rule.category_name.clone().unwrap_or_else(|| rule.category_id.clone()),
                });
            }
        }
    }
    Ok(RuleImpact { count, sample })
}

#[tauri::command]
pub async fn preview_rule(input: RuleInput, overwrite_manual: bool, state: State<'_, AppState>) -> Result<RuleImpact, AppError> {
    validate_rule(&input)?;
    let category_name = sqlx::query_scalar::<_,String>("SELECT name FROM categories WHERE id=? AND deleted_at IS NULL")
        .bind(&input.category_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?;
    let rule = CategorizationRule {
        id:input.id.unwrap_or_default(),name:input.name,priority:input.priority,enabled:input.enabled,
        operator:input.operator,pattern:input.pattern,account_id:input.account_id,movement_type:input.movement_type,
        min_amount_in_cents:input.min_amount_in_cents,max_amount_in_cents:input.max_amount_in_cents,
        category_id:input.category_id,category_name:Some(category_name),use_count:0,is_system:false,
    };
    calculate_impact(&state.db, &rule, overwrite_manual).await
}

#[tauri::command]
pub async fn preview_rules_retroactive(overwrite_manual: bool, state: State<'_, AppState>) -> Result<RuleImpact, AppError> {
    let rules = load_rules(&state.db).await?;
    let rows = sqlx::query(
        "SELECT t.id,t.account_id,t.date,t.description,t.normalized_description,t.amount_cents,
         t.category_source,c.name current_category
         FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.deleted_at IS NULL"
    ).fetch_all(&state.db).await?;
    let mut count = 0;
    let mut sample = Vec::new();
    for row in rows {
        if !overwrite_manual && row.get::<Option<String>,_>("category_source").as_deref() == Some("manual") { continue; }
        let account_id: String = row.get("account_id");
        let description: String = row.get("normalized_description");
        if let Some(rule) = first_match(&rules, &CategorizationInput {
            account_id:&account_id, normalized_description:&description, amount_in_cents:row.get("amount_cents"),
        }) {
            count += 1;
            if sample.len() < 10 {
                sample.push(RuleImpactItem {
                    transaction_id:row.get("id"),date:row.get("date"),description:row.get("description"),
                    current_category:row.get("current_category"),
                    suggested_category:rule.category_name.clone().unwrap_or_else(|| rule.category_id.clone()),
                });
            }
        }
    }
    Ok(RuleImpact { count, sample })
}

#[tauri::command]
pub async fn apply_rules_retroactive(overwrite_manual: bool, state: State<'_, AppState>) -> Result<usize, AppError> {
    let rules = load_rules(&state.db).await?;
    let rows = sqlx::query("SELECT id,account_id,normalized_description,amount_cents,category_source FROM transactions WHERE deleted_at IS NULL").fetch_all(&state.db).await?;
    let mut tx = state.db.begin().await?;
    let mut count = 0;
    for row in rows {
        if !overwrite_manual && row.get::<Option<String>,_>("category_source").as_deref() == Some("manual") { continue; }
        let account_id: String = row.get("account_id");
        let description: String = row.get("normalized_description");
        if let Some(rule) = first_match(&rules, &CategorizationInput {
            account_id:&account_id, normalized_description:&description, amount_in_cents:row.get("amount_cents"),
        }) {
            sqlx::query("UPDATE transactions SET category_id=?,category_source='rule',categorization_rule_id=? WHERE id=?")
                .bind(&rule.category_id).bind(&rule.id).bind(row.get::<String,_>("id")).execute(&mut *tx).await?;
            sqlx::query("UPDATE categorization_rules SET use_count=use_count+1 WHERE id=?").bind(&rule.id).execute(&mut *tx).await?;
            count += 1;
        }
    }
    tx.commit().await?;
    Ok(count)
}

#[tauri::command]
pub async fn update_transaction_category(transaction_id: String, category_id: Option<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    sqlx::query("UPDATE transactions SET category_id=?,category_source='manual',categorization_rule_id=NULL WHERE id=? AND deleted_at IS NULL")
        .bind(category_id).bind(transaction_id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn bulk_update_transaction_category(
    transaction_ids: Vec<String>, category_id: Option<String>, state: State<'_, AppState>
) -> Result<usize, AppError> {
    let ids = normalize_transaction_ids(transaction_ids)?;
    if let Some(id) = &category_id {
        let exists = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(id).fetch_one(&state.db).await? > 0;
        if !exists { return Err(AppError::Validation("Categoria não encontrada".into())); }
    }
    let mut tx = state.db.begin().await?;
    let mut count = 0;
    for id in ids {
        count += sqlx::query(
            "UPDATE transactions SET category_id=?,category_source='manual',categorization_rule_id=NULL
             WHERE id=? AND deleted_at IS NULL"
        ).bind(&category_id).bind(id).execute(&mut *tx).await?.rows_affected() as usize;
    }
    tx.commit().await?;
    Ok(count)
}

#[tauri::command]
pub async fn delete_transactions(transaction_ids: Vec<String>, state: State<'_, AppState>) -> Result<usize, AppError> {
    let ids = normalize_transaction_ids(transaction_ids)?;
    let mut tx = state.db.begin().await?;
    let mut count = 0;
    for id in ids {
        count += sqlx::query("UPDATE transactions SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL")
            .bind(id).execute(&mut *tx).await?.rows_affected() as usize;
    }
    tx.commit().await?;
    Ok(count)
}

#[tauri::command]
pub async fn restore_transactions(transaction_ids: Vec<String>, state: State<'_, AppState>) -> Result<usize, AppError> {
    let ids = normalize_transaction_ids(transaction_ids)?;
    let mut tx = state.db.begin().await?;
    let mut count = 0;
    for id in ids {
        count += sqlx::query("UPDATE transactions SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL")
            .bind(id).execute(&mut *tx).await?.rows_affected() as usize;
    }
    tx.commit().await?;
    Ok(count)
}

#[tauri::command]
pub async fn preview_import(path: String, account_id: String, state: State<'_, AppState>) -> Result<ImportPreview, AppError> {
    let path = PathBuf::from(path);
    let mut candidates = parse_file(&path)?;
    let rules = load_rules(&state.db).await?;
    for candidate in &mut candidates {
        let fp = fingerprint(&account_id, candidate);
        if sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE fingerprint=? OR (external_id IS NOT NULL AND external_id=?)")
            .bind(fp).bind(&candidate.external_id).fetch_one(&state.db).await? > 0 {
            candidate.duplicate_status = crate::domain::import::DuplicateStatus::Exact;
        }
        if let Some(rule) = first_match(&rules, &CategorizationInput {
            account_id:&account_id, normalized_description:&candidate.normalized_description,
            amount_in_cents:candidate.amount_in_cents,
        }) {
            candidate.suggested_category_id = Some(rule.category_id.clone());
            candidate.suggested_category_name = rule.category_name.clone();
            candidate.suggested_rule_id = Some(rule.id.clone());
            candidate.suggested_rule_name = Some(rule.name.clone());
        }
    }
    let session_id = Uuid::new_v4().to_string();
    let file_name = path.file_name().and_then(|x|x.to_str()).unwrap_or("arquivo").to_string();
    state.sessions.lock().await.insert(session_id.clone(), ImportSession { account_id, file_name:file_name.clone(), candidates:candidates.clone() });
    Ok(ImportPreview { session_id, file_name, candidates })
}

#[tauri::command]
pub async fn set_import_candidate_category(
    session_id: String, source_row: usize, category_id: Option<String>, state: State<'_, AppState>
) -> Result<(), AppError> {
    let category_name = if let Some(id) = &category_id {
        sqlx::query_scalar::<_,String>("SELECT name FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(id).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?.into()
    } else { None };
    let mut sessions = state.sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or(AppError::SessionExpired)?;
    let candidate = session.candidates.iter_mut().find(|c| c.source_row == source_row)
        .ok_or_else(|| AppError::Validation("Lançamento não encontrado na sessão".into()))?;
    candidate.suggested_category_id = category_id;
    candidate.suggested_category_name = category_name;
    candidate.suggested_rule_id = None;
    candidate.suggested_rule_name = None;
    Ok(())
}

#[tauri::command]
pub async fn commit_import(session_id: String, state: State<'_, AppState>) -> Result<usize, AppError> {
    let session = state.sessions.lock().await.remove(&session_id).ok_or(AppError::SessionExpired)?;
    let mut tx = state.db.begin().await?;
    let batch_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO import_batches(id,file_name,created_at) VALUES(?,?,datetime('now'))").bind(&batch_id).bind(session.file_name).execute(&mut *tx).await?;
    let mut count = 0;
    for candidate in session.candidates {
        if matches!(candidate.duplicate_status, crate::domain::import::DuplicateStatus::Exact) { continue; }
        let source = if candidate.suggested_rule_id.is_some() { Some("rule") } else if candidate.suggested_category_id.is_some() { Some("manual") } else { None };
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,external_id,fingerprint,
             status,import_batch_id,category_id,category_source,categorization_rule_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(Uuid::new_v4().to_string()).bind(&session.account_id).bind(&candidate.date)
            .bind(&candidate.description).bind(&candidate.normalized_description).bind(candidate.amount_in_cents)
            .bind(&candidate.external_id).bind(fingerprint(&session.account_id,&candidate)).bind("cleared")
            .bind(&batch_id).bind(&candidate.suggested_category_id).bind(source).bind(&candidate.suggested_rule_id)
            .execute(&mut *tx).await?;
        if let Some(rule_id) = candidate.suggested_rule_id {
            sqlx::query("UPDATE categorization_rules SET use_count=use_count+1 WHERE id=?").bind(rule_id).execute(&mut *tx).await?;
        }
        count += 1;
    }
    tx.commit().await?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bulk_ids_are_deduplicated_and_bounded() {
        assert_eq!(normalize_transaction_ids(vec!["a".into(), "a".into(), "b".into()]).unwrap(), vec!["a", "b"]);
        assert!(normalize_transaction_ids(vec![]).is_err());
        assert!(normalize_transaction_ids((0..1001).map(|i| i.to_string()).collect()).is_err());
    }
}
