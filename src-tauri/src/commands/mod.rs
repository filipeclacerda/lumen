use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

mod credit_card;
pub use credit_card::*;
mod reports;
pub use reports::*;
mod backup;
pub use backup::*;

use crate::{
    application::state::{AppState, ImportSession},
    domain::{
        categorization::{first_match, CategorizationInput, CategorizationRule, MovementType, RuleOperator},
        import::{
            fingerprint, mapping_signature, normalize_description, CsvColumnMapping, CsvMappingDraft,
            CsvMappingProfile, ImportCandidate, ImportSourceKind,
        },
    },
    error::AppError,
    infrastructure::importer::{
        detect_import_kind as detect_import_kind_from_file, inspect_csv_file, parse_file,
        parse_mapped_bank_csv,
    },
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account { id: String, name: String, kind: String, balance_in_cents: i64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    id: Option<String>,
    account_id: String,
    date: String,
    description: String,
    amount_in_cents: i64,
    category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    display_name: String,
    monthly_income_in_cents: Option<i64>,
    income_day: Option<i64>,
    financial_goal: Option<String>,
    onboarding_completed_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    display_name: String,
    monthly_income_in_cents: Option<i64>,
    income_day: Option<i64>,
    financial_goal: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingInput {
    display_name: String,
    monthly_income_in_cents: Option<i64>,
    income_day: Option<i64>,
    financial_goal: Option<String>,
    account_name: String,
    account_kind: String,
    opening_balance_in_cents: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrap {
    profile: Option<UserProfile>,
    onboarding_completed: bool,
    account: Option<Account>,
    has_transactions: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingResult { profile: UserProfile, account_id: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    id: String, account_id: String, account_name: String, account_kind: String,
    date: String, description: String,
    amount_in_cents: i64, category_id: Option<String>, category: Option<String>,
    category_source: Option<String>, status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    income_in_cents: i64, expenses_in_cents: i64, investments_in_cents: i64, balance_in_cents: i64,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileInspection {
    file_name: String,
    detected_kind: String,
    delimiter: Option<String>,
    headers: Vec<String>,
    sample_rows: Vec<Vec<String>>,
    matched_profiles: Vec<CsvMappingProfile>,
    suggested_source_kind: Option<ImportSourceKind>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateKind { Bank, CreditCard }

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

pub(super) async fn load_rules(db: &SqlitePool) -> Result<Vec<CategorizationRule>, AppError> {
    let rows = sqlx::query(
        "SELECT r.*, c.name category_name FROM categorization_rules r
         JOIN categories c ON c.id=r.category_id
         WHERE r.deleted_at IS NULL ORDER BY r.priority, r.created_at"
    ).fetch_all(db).await?;
    Ok(rows.into_iter().map(rule_from_row).collect())
}

fn source_kind_str(value: ImportSourceKind) -> &'static str {
    match value {
        ImportSourceKind::Bank => "bank",
        ImportSourceKind::CreditCard => "credit_card",
    }
}

fn template_contents(kind: &TemplateKind) -> &'static str {
    match kind {
        TemplateKind::Bank => concat!(
            "source_kind;date;description;amount;external_id;balance\n",
            "bank;2026-06-01;SALARIO;3500,00;folha-001;3500,00\n",
            "bank;2026-06-02;SUPERMERCADO;-245,90;compra-001;3254,10\n",
        ),
        TemplateKind::CreditCard => concat!(
            "source_kind;purchase_date;description;amount;row_kind;holder;installment;due_date;external_id\n",
            "credit_card;2026-06-01;SUPERMERCADO;245,90;purchase;TITULAR;1/1;2026-07-10;fatura-001\n",
            "credit_card;2026-06-05;PAGAMENTO FATURA;245,90;payment;TITULAR;;2026-07-10;pagamento-001\n",
        ),
    }
}

fn validate_mapping_draft(mapping: &CsvMappingDraft) -> Result<(), AppError> {
    if mapping.columns.is_empty() {
        return Err(AppError::Validation("Mapeie ao menos uma coluna".into()));
    }
    if mapping.delimiter.chars().count() != 1 {
        return Err(AppError::Validation("Escolha um delimitador válido".into()));
    }
    Ok(())
}

fn mapping_profile_from_row(row: SqliteRow) -> Result<CsvMappingProfile, AppError> {
    let columns = serde_json::from_str::<Vec<CsvColumnMapping>>(&row.get::<String, _>("columns_json"))
        .map_err(|_| AppError::Validation("Perfil de layout inválido".into()))?;
    Ok(CsvMappingProfile {
        id: row.get("id"),
        name: row.get("name"),
        source_kind: if row.get::<String, _>("source_kind") == "credit_card" {
            ImportSourceKind::CreditCard
        } else {
            ImportSourceKind::Bank
        },
        delimiter: row.get("delimiter"),
        date_format: row.get("date_format"),
        decimal_separator: row.get("decimal_separator"),
        signature: row.get("signature"),
        columns,
    })
}

async fn list_matching_profiles(
    db: &SqlitePool,
    headers: &[String],
    delimiter: &str,
) -> Result<Vec<CsvMappingProfile>, AppError> {
    let bank_signature = mapping_signature(headers, delimiter, ImportSourceKind::Bank);
    let card_signature = mapping_signature(headers, delimiter, ImportSourceKind::CreditCard);
    let rows = sqlx::query(
        "SELECT id,name,source_kind,delimiter,date_format,decimal_separator,signature,columns_json
         FROM csv_mapping_profiles
         WHERE signature IN (?,?)
         ORDER BY created_at"
    ).bind(bank_signature).bind(card_signature).fetch_all(db).await?;
    rows.into_iter().map(mapping_profile_from_row).collect()
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

fn validate_profile(
    display_name: &str,
    monthly_income_in_cents: Option<i64>,
    income_day: Option<i64>,
    financial_goal: Option<&str>,
) -> Result<(), AppError> {
    let name_length = display_name.trim().chars().count();
    if !(2..=80).contains(&name_length) {
        return Err(AppError::Validation("O nome deve ter entre 2 e 80 caracteres".into()));
    }
    if monthly_income_in_cents.is_some_and(|income| income < 0) {
        return Err(AppError::Validation("A renda mensal não pode ser negativa".into()));
    }
    if income_day.is_some_and(|day| !(1..=31).contains(&day)) {
        return Err(AppError::Validation("O dia de recebimento deve estar entre 1 e 31".into()));
    }
    if financial_goal.is_some_and(|goal| !["organize","emergency_fund","pay_debt","save","invest"].contains(&goal)) {
        return Err(AppError::Validation("Objetivo financeiro inválido".into()));
    }
    Ok(())
}

fn profile_from_row(row: SqliteRow) -> UserProfile {
    UserProfile {
        display_name: row.get("display_name"),
        monthly_income_in_cents: row.get("monthly_income_cents"),
        income_day: row.get("income_day"),
        financial_goal: row.get("financial_goal"),
        onboarding_completed_at: row.get("onboarding_completed_at"),
    }
}

async fn load_profile(db: &SqlitePool) -> Result<Option<UserProfile>, AppError> {
    Ok(sqlx::query(
        "SELECT display_name,monthly_income_cents,income_day,financial_goal,onboarding_completed_at
         FROM user_profiles WHERE id='primary'"
    ).fetch_optional(db).await?.map(profile_from_row))
}

#[tauri::command]
pub async fn get_app_bootstrap(state: State<'_, AppState>) -> Result<AppBootstrap, AppError> {
    let profile = load_profile(&state.db).await?;
    let account_row = sqlx::query(
        "SELECT id,name,kind,(SELECT COALESCE(SUM(amount_cents),0) FROM transactions t
         WHERE t.account_id=a.id AND t.deleted_at IS NULL) balance
         FROM accounts a WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1"
    ).fetch_optional(&state.db).await?;
    let account = account_row.map(|r| Account {
        id:r.get("id"),name:r.get("name"),kind:r.get("kind"),balance_in_cents:r.get("balance"),
    });
    let has_transactions = sqlx::query_scalar::<_,i64>(
        "SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL"
    ).fetch_one(&state.db).await? > 0;
    Ok(AppBootstrap { onboarding_completed: profile.is_some(), profile, account, has_transactions })
}

#[tauri::command]
pub async fn get_profile(state: State<'_, AppState>) -> Result<Option<UserProfile>, AppError> {
    load_profile(&state.db).await
}

#[tauri::command]
pub async fn save_profile(input: ProfileInput, state: State<'_, AppState>) -> Result<UserProfile, AppError> {
    validate_profile(&input.display_name, input.monthly_income_in_cents, input.income_day, input.financial_goal.as_deref())?;
    let result = sqlx::query(
        "UPDATE user_profiles SET display_name=?,monthly_income_cents=?,income_day=?,
         financial_goal=?,updated_at=datetime('now') WHERE id='primary'"
    ).bind(input.display_name.trim()).bind(input.monthly_income_in_cents).bind(input.income_day)
        .bind(input.financial_goal).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Validation("Conclua o cadastro inicial antes de editar o perfil".into()));
    }
    load_profile(&state.db).await?.ok_or_else(|| AppError::Validation("Perfil não encontrado".into()))
}

#[tauri::command]
pub async fn complete_onboarding(input: OnboardingInput, state: State<'_, AppState>) -> Result<OnboardingResult, AppError> {
    complete_onboarding_impl(input, &state.db).await
}

async fn complete_onboarding_impl(input: OnboardingInput, db: &SqlitePool) -> Result<OnboardingResult, AppError> {
    validate_profile(&input.display_name, input.monthly_income_in_cents, input.income_day, input.financial_goal.as_deref())?;
    let account_name_length = input.account_name.trim().chars().count();
    if !(2..=80).contains(&account_name_length) {
        return Err(AppError::Validation("O nome da conta deve ter entre 2 e 80 caracteres".into()));
    }
    if !["checking","savings","cash"].contains(&input.account_kind.as_str()) {
        return Err(AppError::Validation("Tipo de conta inválido".into()));
    }
    let has_transactions = sqlx::query_scalar::<_,i64>(
        "SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL"
    ).fetch_one(db).await? > 0;
    if has_transactions && input.opening_balance_in_cents.is_some_and(|value| value != 0) {
        return Err(AppError::Validation("O saldo inicial não pode ser aplicado após existirem transações".into()));
    }

    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO user_profiles(id,display_name,monthly_income_cents,income_day,financial_goal,onboarding_completed_at)
         VALUES('primary',?,?,?,?,datetime('now'))
         ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
         monthly_income_cents=excluded.monthly_income_cents,income_day=excluded.income_day,
         financial_goal=excluded.financial_goal,onboarding_completed_at=excluded.onboarding_completed_at,
         updated_at=datetime('now')"
    ).bind(input.display_name.trim()).bind(input.monthly_income_in_cents).bind(input.income_day)
        .bind(input.financial_goal).execute(&mut *tx).await?;

    let account_id = sqlx::query_scalar::<_,String>(
        "SELECT id FROM accounts WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1"
    ).fetch_optional(&mut *tx).await?.unwrap_or_else(|| Uuid::new_v4().to_string());
    let account_exists = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM accounts WHERE id=?")
        .bind(&account_id).fetch_one(&mut *tx).await? > 0;
    if account_exists {
        sqlx::query("UPDATE accounts SET name=?,kind=? WHERE id=?")
            .bind(input.account_name.trim()).bind(&input.account_kind).bind(&account_id).execute(&mut *tx).await?;
    } else {
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,?)")
            .bind(&account_id).bind(input.account_name.trim()).bind(&input.account_kind).execute(&mut *tx).await?;
    }
    if !has_transactions {
        if let Some(balance) = input.opening_balance_in_cents.filter(|value| *value != 0) {
            let transaction_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,
                 fingerprint,category_id,category_source,status) VALUES(?,?,?,?,?,?,?,?,?,?)"
            ).bind(transaction_id).bind(&account_id).bind(chrono::Local::now().format("%Y-%m-%d").to_string())
                .bind("Saldo inicial").bind("SALDO INICIAL").bind(balance)
                .bind(format!("onboarding:opening-balance:{account_id}")).bind("opening-balance")
                .bind("manual").bind("cleared").execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    let profile = load_profile(db).await?.ok_or_else(|| AppError::Validation("Perfil não encontrado".into()))?;
    Ok(OnboardingResult { profile, account_id })
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, AppError> {
    let rows = sqlx::query("SELECT id,name,kind,(SELECT COALESCE(SUM(amount_cents),0) FROM transactions t WHERE t.account_id=a.id AND t.deleted_at IS NULL) balance FROM accounts a WHERE deleted_at IS NULL ORDER BY name").fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| Account { id:r.get("id"), name:r.get("name"), kind:r.get("kind"), balance_in_cents:r.get("balance") }).collect())
}

fn validate_account_name(name: &str) -> Result<(), AppError> {
    if !(2..=80).contains(&name.trim().chars().count()) {
        return Err(AppError::Validation("O nome da conta deve ter entre 2 e 80 caracteres".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn create_account(name: String, kind: String, state: State<'_, AppState>) -> Result<String, AppError> {
    validate_account_name(&name)?;
    if !["checking","savings","cash","credit_card"].contains(&kind.as_str()) {
        return Err(AppError::Validation("Tipo de conta inválido".into()));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,?)")
        .bind(&id).bind(name.trim()).bind(&kind).execute(&state.db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn rename_account(id: String, name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    validate_account_name(&name)?;
    let result = sqlx::query("UPDATE accounts SET name=? WHERE id=? AND deleted_at IS NULL")
        .bind(name.trim()).bind(id).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Validation("Conta não encontrada".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn archive_account(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let has_active_transactions = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE account_id=? AND deleted_at IS NULL"
    ).bind(&id).fetch_one(&state.db).await? > 0;
    if has_active_transactions {
        return Err(AppError::Validation("A conta tem transações ativas; mova ou exclua essas transações antes de arquivá-la".into()));
    }
    let remaining = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM accounts WHERE deleted_at IS NULL AND id!=?"
    ).bind(&id).fetch_one(&state.db).await?;
    if remaining == 0 {
        return Err(AppError::Validation("Mantenha ao menos uma conta ativa".into()));
    }
    let result = sqlx::query("UPDATE accounts SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL")
        .bind(id).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Validation("Conta não encontrada".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_transactions(month: Option<String>, state: State<'_, AppState>) -> Result<Vec<Transaction>, AppError> {
    let mut q = "SELECT t.id,t.account_id,a.name account_name,a.kind account_kind,t.date,t.description,t.amount_cents,t.category_id,
                 COALESCE(c.name,'Sem categoria') category,t.category_source,t.status
                 FROM transactions t JOIN accounts a ON a.id=t.account_id
                 LEFT JOIN categories c ON c.id=t.category_id
                 WHERE t.deleted_at IS NULL
                 AND NOT (a.kind='credit_card' AND t.amount_cents>0 AND t.category_id='credit-card-payment')".to_string();
    if month.is_some() {
        q.push_str(" AND strftime('%Y-%m', t.date) = ?");
    }
    q.push_str(" ORDER BY date DESC LIMIT 500");
    
    let mut query = sqlx::query(&q);
    if let Some(m) = &month { query = query.bind(m); }
    let rows = query.fetch_all(&state.db).await?;
    
    Ok(rows.into_iter().map(|r| Transaction {
        id:r.get("id"), account_id:r.get("account_id"), account_name:r.get("account_name"),
        account_kind:r.get("account_kind"), date:r.get("date"),
        description:r.get("description"), amount_in_cents:r.get("amount_cents"),
        category_id:r.get("category_id"), category:r.get("category"),
        category_source:r.get("category_source"), status:r.get("status"),
    }).collect())
}

#[tauri::command]
pub async fn dashboard_summary(month: Option<String>, state: State<'_, AppState>) -> Result<Summary, AppError> {
    let m = month.unwrap_or_else(|| chrono::Local::now().format("%Y-%m").to_string());
    let r = sqlx::query(
        "SELECT
         COALESCE(SUM(CASE WHEN t.amount_cents>0 AND COALESCE(c.kind,'income') NOT IN ('transfer','investment') THEN t.amount_cents ELSE 0 END),0) income,
         COALESCE(-SUM(CASE WHEN t.amount_cents<0 AND COALESCE(c.kind,'expense') NOT IN ('transfer','investment') THEN t.amount_cents ELSE 0 END),0) expenses,
         COALESCE(-SUM(CASE WHEN t.amount_cents<0 AND COALESCE(c.kind,'expense') = 'investment' THEN t.amount_cents ELSE 0 END),0) investments,
         COALESCE(SUM(t.amount_cents),0) balance, COUNT(*) count
         FROM transactions t LEFT JOIN categories c ON c.id=t.category_id 
         WHERE t.deleted_at IS NULL AND strftime('%Y-%m', t.date) = ?"
    ).bind(&m).fetch_one(&state.db).await?;
    let cats = sqlx::query(
        "SELECT COALESCE(c.name,'Sem categoria') category,-SUM(t.amount_cents) amount
         FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.amount_cents<0 AND t.deleted_at IS NULL AND COALESCE(c.kind,'expense') NOT IN ('transfer','investment')
         AND strftime('%Y-%m', t.date) = ?
         GROUP BY category ORDER BY amount DESC LIMIT 6"
    ).bind(&m).fetch_all(&state.db).await?;
    Ok(Summary {
        income_in_cents:r.get("income"), expenses_in_cents:r.get("expenses"),
        investments_in_cents:r.get("investments"),
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
            .bind((index as i64 + 1) * 10).bind(id).execute(&mut *tx).await.map_err(|e| { println!("DB ERROR: {:?}", e); e })?;
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
    let mut rule_hits: HashMap<String, i64> = HashMap::new();
    for row in rows {
        if !overwrite_manual && row.get::<Option<String>,_>("category_source").as_deref() == Some("manual") { continue; }
        let account_id: String = row.get("account_id");
        let description: String = row.get("normalized_description");
        if let Some(rule) = first_match(&rules, &CategorizationInput {
            account_id:&account_id, normalized_description:&description, amount_in_cents:row.get("amount_cents"),
        }) {
            sqlx::query("UPDATE transactions SET category_id=?,category_source='rule',categorization_rule_id=? WHERE id=?")
                .bind(&rule.category_id).bind(&rule.id).bind(row.get::<String,_>("id")).execute(&mut *tx).await?;
            *rule_hits.entry(rule.id.clone()).or_insert(0) += 1;
            count += 1;
        }
    }
    // Apply each rule's hit count in a single update to keep use_count consistent.
    for (rule_id, hits) in rule_hits {
        sqlx::query("UPDATE categorization_rules SET use_count=use_count+? WHERE id=?")
            .bind(hits).bind(rule_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(count)
}

fn validate_transaction_input(input: &TransactionInput) -> Result<(), AppError> {
    if input.amount_in_cents == 0 {
        return Err(AppError::Validation("O valor da transação não pode ser zero".into()));
    }
    let description_length = input.description.trim().chars().count();
    if !(1..=200).contains(&description_length) {
        return Err(AppError::Validation("A descrição deve ter entre 1 e 200 caracteres".into()));
    }
    chrono::NaiveDate::parse_from_str(input.date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Data inválida".into()))?;
    Ok(())
}

async fn ensure_account_active(db: &SqlitePool, account_id: &str) -> Result<(), AppError> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM accounts WHERE id=? AND deleted_at IS NULL")
        .bind(account_id).fetch_one(db).await? > 0;
    if !exists { return Err(AppError::Validation("Conta não encontrada".into())); }
    Ok(())
}

async fn ensure_category_active(db: &SqlitePool, category_id: &Option<String>) -> Result<(), AppError> {
    if let Some(id) = category_id {
        let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(id).fetch_one(db).await? > 0;
        if !exists { return Err(AppError::Validation("Categoria não encontrada".into())); }
    }
    Ok(())
}

/// Builds the deduplication fingerprint for a manually-entered transaction,
/// reusing the same logic as the importer (ADR 0002).
fn manual_fingerprint(account_id: &str, date: &str, description: &str, normalized: &str, amount_in_cents: i64) -> String {
    let candidate = ImportCandidate {
        source_row: 0,
        date: date.to_string(),
        description: description.to_string(),
        normalized_description: normalized.to_string(),
        amount_in_cents,
        external_id: None,
        suggested_category_id: None,
        suggested_category_name: None,
        suggested_rule_id: None,
        suggested_rule_name: None,
        duplicate_status: crate::domain::import::DuplicateStatus::New,
        warnings: vec![],
        included: true,
    };
    fingerprint(account_id, &candidate)
}

#[tauri::command]
pub async fn create_transaction(input: TransactionInput, state: State<'_, AppState>) -> Result<String, AppError> {
    create_transaction_impl(input, &state.db).await
}

async fn create_transaction_impl(input: TransactionInput, db: &SqlitePool) -> Result<String, AppError> {
    validate_transaction_input(&input)?;
    ensure_account_active(db, &input.account_id).await?;
    ensure_category_active(db, &input.category_id).await?;
    let description = input.description.trim().to_string();
    let normalized = normalize_description(&description);
    let date = input.date.trim().to_string();
    let fp = manual_fingerprint(&input.account_id, &date, &description, &normalized, input.amount_in_cents);
    let collides = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND deleted_at IS NULL"
    ).bind(&fp).fetch_one(db).await? > 0;
    if collides {
        return Err(AppError::Validation("Já existe uma transação idêntica (mesma conta, data, descrição e valor)".into()));
    }
    let id = Uuid::new_v4().to_string();
    let source = input.category_id.as_ref().map(|_| "manual");
    sqlx::query(
        "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,category_id,category_source,status)
         VALUES(?,?,?,?,?,?,?,?,?,'cleared')"
    ).bind(&id).bind(&input.account_id).bind(&date).bind(&description).bind(&normalized)
        .bind(input.amount_in_cents).bind(&fp).bind(&input.category_id).bind(source)
        .execute(db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn update_transaction(input: TransactionInput, state: State<'_, AppState>) -> Result<(), AppError> {
    let id = input.id.clone().ok_or_else(|| AppError::Validation("Transação inválida".into()))?;
    validate_transaction_input(&input)?;
    ensure_account_active(&state.db, &input.account_id).await?;
    ensure_category_active(&state.db, &input.category_id).await?;
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE id=? AND deleted_at IS NULL")
        .bind(&id).fetch_one(&state.db).await? > 0;
    if !exists { return Err(AppError::Validation("Transação não encontrada".into())); }
    let description = input.description.trim().to_string();
    let normalized = normalize_description(&description);
    let date = input.date.trim().to_string();
    let fp = manual_fingerprint(&input.account_id, &date, &description, &normalized, input.amount_in_cents);
    let collides = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND id!=? AND deleted_at IS NULL"
    ).bind(&fp).bind(&id).fetch_one(&state.db).await? > 0;
    if collides {
        return Err(AppError::Validation("Já existe uma transação idêntica (mesma conta, data, descrição e valor)".into()));
    }
    let source = input.category_id.as_ref().map(|_| "manual");
    sqlx::query(
        "UPDATE transactions SET account_id=?,date=?,description=?,normalized_description=?,amount_cents=?,
         fingerprint=?,category_id=?,category_source=?,categorization_rule_id=NULL
         WHERE id=? AND deleted_at IS NULL"
    ).bind(&input.account_id).bind(&date).bind(&description).bind(&normalized).bind(input.amount_in_cents)
        .bind(&fp).bind(&input.category_id).bind(source).bind(&id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn update_transaction_category(transaction_id: String, category_id: Option<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    sqlx::query("UPDATE transactions SET category_id=?,category_source='manual',categorization_rule_id=NULL WHERE id=? AND deleted_at IS NULL")
        .bind(category_id).bind(transaction_id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn update_transaction_amount(
    transaction_id: String, amount_in_cents: i64, state: State<'_, AppState>
) -> Result<(), AppError> {
    if amount_in_cents == 0 {
        return Err(AppError::Validation("O valor da transação não pode ser zero".into()));
    }
    let row = sqlx::query(
        "SELECT account_id,date,description,normalized_description,external_id
         FROM transactions WHERE id=? AND deleted_at IS NULL"
    ).bind(&transaction_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Validation("Transação não encontrada".into()))?;
    let candidate = ImportCandidate {
        source_row: 0,
        date: row.get("date"),
        description: row.get("description"),
        normalized_description: row.get("normalized_description"),
        amount_in_cents,
        external_id: row.get("external_id"),
        suggested_category_id: None,
        suggested_category_name: None,
        suggested_rule_id: None,
        suggested_rule_name: None,
        duplicate_status: crate::domain::import::DuplicateStatus::New,
        warnings: vec![],
        included: true,
    };
    let account_id: String = row.get("account_id");
    let fp = fingerprint(&account_id, &candidate);
    let collides = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND id!=? AND deleted_at IS NULL"
    ).bind(&fp).bind(&transaction_id).fetch_one(&state.db).await? > 0;
    if collides {
        return Err(AppError::Validation("Esse valor deixaria a transação idêntica a outra já existente".into()));
    }
    sqlx::query("UPDATE transactions SET amount_cents=?,fingerprint=? WHERE id=?")
        .bind(amount_in_cents).bind(&fp).bind(transaction_id)
        .execute(&state.db).await?;
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
        // Refuse to restore a transaction whose fingerprint now matches an active one,
        // otherwise the restore would silently re-create a duplicate.
        if let Some(fp) = sqlx::query_scalar::<_, String>(
            "SELECT fingerprint FROM transactions WHERE id=? AND deleted_at IS NOT NULL"
        ).bind(&id).fetch_optional(&mut *tx).await? {
            let collides = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND id!=? AND deleted_at IS NULL"
            ).bind(&fp).bind(&id).fetch_one(&mut *tx).await? > 0;
            if collides {
                return Err(AppError::Validation(
                    "Não é possível restaurar: já existe uma transação idêntica ativa".into()
                ));
            }
        }
        count += sqlx::query("UPDATE transactions SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL")
            .bind(&id).execute(&mut *tx).await?.rows_affected() as usize;
    }
    tx.commit().await?;
    Ok(count)
}

#[tauri::command]
pub async fn inspect_import_file(path: String, state: State<'_, AppState>) -> Result<ImportFileInspection, AppError> {
    let path = PathBuf::from(&path);
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("arquivo").to_string();
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    if extension != "csv" {
        let detected_kind = detect_import_kind_from_file(&path)?.as_str().to_string();
        return Ok(ImportFileInspection {
            file_name,
            detected_kind,
            delimiter: None,
            headers: vec![],
            sample_rows: vec![],
            matched_profiles: vec![],
            suggested_source_kind: Some(ImportSourceKind::Bank),
        });
    }
    let inspection = inspect_csv_file(&path)?;
    let matched_profiles = list_matching_profiles(&state.db, &inspection.headers, &inspection.delimiter).await?;
    let suggested_source_kind = matched_profiles.first().map(|profile| profile.source_kind);
    Ok(ImportFileInspection {
        file_name,
        detected_kind: detect_import_kind_from_file(&path)?.as_str().to_string(),
        delimiter: Some(inspection.delimiter),
        headers: inspection.headers,
        sample_rows: inspection.sample_rows,
        matched_profiles,
        suggested_source_kind,
    })
}

#[tauri::command]
pub async fn list_csv_mapping_profiles(state: State<'_, AppState>) -> Result<Vec<CsvMappingProfile>, AppError> {
    let rows = sqlx::query(
        "SELECT id,name,source_kind,delimiter,date_format,decimal_separator,signature,columns_json
         FROM csv_mapping_profiles ORDER BY created_at"
    ).fetch_all(&state.db).await?;
    rows.into_iter().map(mapping_profile_from_row).collect()
}

#[tauri::command]
pub async fn save_csv_mapping_profile(mapping: CsvMappingDraft, state: State<'_, AppState>) -> Result<String, AppError> {
    validate_mapping_draft(&mapping)?;
    let id = Uuid::new_v4().to_string();
    let signature = mapping_signature(
        &mapping.columns.iter().map(|column| column.header.clone()).collect::<Vec<_>>(),
        &mapping.delimiter,
        mapping.source_kind,
    );
    let name = mapping.profile_name.clone().unwrap_or_else(|| match mapping.source_kind {
        ImportSourceKind::Bank => "Layout conta bancária".into(),
        ImportSourceKind::CreditCard => "Layout cartão de crédito".into(),
    });
    let result = sqlx::query(
        "INSERT INTO csv_mapping_profiles(id,name,source_kind,delimiter,date_format,decimal_separator,signature,columns_json,updated_at)
         VALUES(?,?,?,?,?,?,?,?,datetime('now'))"
    ).bind(&id).bind(name.trim()).bind(source_kind_str(mapping.source_kind)).bind(&mapping.delimiter)
        .bind(&mapping.date_format).bind(&mapping.decimal_separator).bind(signature)
        .bind(serde_json::to_string(&mapping.columns).map_err(|_| AppError::Validation("Layout inválido".into()))?)
        .execute(&state.db).await;
    match result {
        Ok(_) => Ok(id),
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
            Err(AppError::Validation("Já existe um layout salvo para esse conjunto de colunas e tipo".into()))
        }
        Err(error) => Err(AppError::Database(error)),
    }
}

#[tauri::command]
pub async fn delete_csv_mapping_profile(profile_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    sqlx::query("DELETE FROM csv_mapping_profiles WHERE id=?").bind(profile_id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn export_import_template(path: String, template_kind: TemplateKind) -> Result<(), AppError> {
    std::fs::write(path, template_contents(&template_kind))?;
    Ok(())
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
            candidate.included = false;
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
pub async fn preview_mapped_bank_import(
    path: String,
    account_id: String,
    mapping: CsvMappingDraft,
    state: State<'_, AppState>,
) -> Result<ImportPreview, AppError> {
    validate_mapping_draft(&mapping)?;
    let path = PathBuf::from(path);
    let mut candidates = parse_mapped_bank_csv(&path, &mapping)?;
    let rules = load_rules(&state.db).await?;
    for candidate in &mut candidates {
        let fp = fingerprint(&account_id, candidate);
        if sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transactions WHERE fingerprint=? OR (external_id IS NOT NULL AND external_id=?)"
        ).bind(fp).bind(&candidate.external_id).fetch_one(&state.db).await? > 0 {
            candidate.duplicate_status = crate::domain::import::DuplicateStatus::Exact;
            candidate.included = false;
        }
        if let Some(rule) = first_match(&rules, &CategorizationInput {
            account_id: &account_id,
            normalized_description: &candidate.normalized_description,
            amount_in_cents: candidate.amount_in_cents,
        }) {
            candidate.suggested_category_id = Some(rule.category_id.clone());
            candidate.suggested_category_name = rule.category_name.clone();
            candidate.suggested_rule_id = Some(rule.id.clone());
            candidate.suggested_rule_name = Some(rule.name.clone());
        }
    }
    let session_id = Uuid::new_v4().to_string();
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("arquivo").to_string();
    state.sessions.lock().await.insert(session_id.clone(), ImportSession {
        account_id,
        file_name: file_name.clone(),
        candidates: candidates.clone(),
    });
    Ok(ImportPreview { session_id, file_name, candidates })
}

#[tauri::command]
pub async fn update_import_candidate(
    session_id: String, source_row: usize, amount_in_cents: i64, included: bool,
    state: State<'_, AppState>
) -> Result<ImportCandidate, AppError> {
    if amount_in_cents == 0 {
        return Err(AppError::Validation("O valor da transação não pode ser zero".into()));
    }
    let mut sessions = state.sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or(AppError::SessionExpired)?;
    let account_id = session.account_id.clone();
    let candidate = session.candidates.iter_mut().find(|c| c.source_row == source_row)
        .ok_or_else(|| AppError::Validation("Lançamento não encontrado na sessão".into()))?;
    candidate.amount_in_cents = amount_in_cents;
    let fp = fingerprint(&account_id, candidate);
    let duplicate = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL
         AND (fingerprint=? OR (external_id IS NOT NULL AND external_id=?))"
    ).bind(fp).bind(&candidate.external_id).fetch_one(&state.db).await? > 0;
    candidate.duplicate_status = if duplicate {
        crate::domain::import::DuplicateStatus::Exact
    } else {
        crate::domain::import::DuplicateStatus::New
    };
    candidate.included = included && !duplicate;
    Ok(candidate.clone())
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
    sqlx::query("INSERT INTO import_batches(id,file_name,created_at) VALUES(?,?,datetime('now'))").bind(&batch_id).bind(session.file_name).execute(&mut *tx).await.map_err(|e| { println!("DB ERROR: {:?}", e); e })?;
    let mut count = 0;
    for candidate in session.candidates {
        if !candidate.included || matches!(candidate.duplicate_status, crate::domain::import::DuplicateStatus::Exact) { continue; }
        let source = if candidate.suggested_rule_id.is_some() { Some("rule") } else if candidate.suggested_category_id.is_some() { Some("manual") } else { None };
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,external_id,fingerprint,
             status,import_batch_id,category_id,category_source,categorization_rule_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(Uuid::new_v4().to_string()).bind(&session.account_id).bind(&candidate.date)
            .bind(&candidate.description).bind(&candidate.normalized_description).bind(candidate.amount_in_cents)
            .bind(&candidate.external_id).bind(fingerprint(&session.account_id,&candidate)).bind("cleared")
            .bind(&batch_id).bind(&candidate.suggested_category_id).bind(source).bind(&candidate.suggested_rule_id)
            .execute(&mut *tx).await.map_err(|e| { println!("DB ERROR: {:?}", e); e })?;
        if let Some(rule_id) = candidate.suggested_rule_id {
            sqlx::query("UPDATE categorization_rules SET use_count=use_count+1 WHERE id=?").bind(rule_id).execute(&mut *tx).await.map_err(|e| { println!("DB ERROR: {:?}", e); e })?;
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

    #[test]
    fn profile_validation_rejects_invalid_values() {
        assert!(validate_profile("A", None, None, None).is_err());
        assert!(validate_profile("Nome válido", Some(-1), None, None).is_err());
        assert!(validate_profile("Nome válido", None, Some(32), None).is_err());
        assert!(validate_profile("Nome válido", None, None, Some("unknown")).is_err());
        assert!(validate_profile("Nome válido", Some(500_000), Some(5), Some("organize")).is_ok());
    }

    #[tokio::test]
    async fn onboarding_persists_profile_account_and_single_opening_balance() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("onboarding.db")).await.unwrap();
        let input = OnboardingInput {
            display_name:"Pessoa Teste".into(),monthly_income_in_cents:Some(500_000),
            income_day:Some(5),financial_goal:Some("organize".into()),
            account_name:"Minha conta".into(),account_kind:"checking".into(),
            opening_balance_in_cents:Some(123_456),
        };
        let result = complete_onboarding_impl(input, &db).await.unwrap();
        assert_eq!(result.profile.display_name, "Pessoa Teste");
        let account_name: String = sqlx::query_scalar("SELECT name FROM accounts WHERE id=?")
            .bind(result.account_id).fetch_one(&db).await.unwrap();
        assert_eq!(account_name, "Minha conta");
        let opening_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions t JOIN categories c ON c.id=t.category_id
             WHERE c.kind='transfer' AND t.normalized_description='SALDO INICIAL'"
        ).fetch_one(&db).await.unwrap();
        assert_eq!(opening_count, 1);

        let duplicate = OnboardingInput {
            display_name:"Pessoa Teste".into(),monthly_income_in_cents:None,income_day:None,
            financial_goal:None,account_name:"Minha conta".into(),account_kind:"checking".into(),
            opening_balance_in_cents:Some(100),
        };
        assert!(complete_onboarding_impl(duplicate, &db).await.is_err());
        let final_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions WHERE normalized_description='SALDO INICIAL'")
            .fetch_one(&db).await.unwrap();
        assert_eq!(final_count, 1);
    }

    #[tokio::test]
    async fn manual_transaction_rejects_duplicate_fingerprint() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("manual.db")).await.unwrap();
        let onboarding = OnboardingInput {
            display_name:"Pessoa Teste".into(),monthly_income_in_cents:None,income_day:None,
            financial_goal:None,account_name:"Conta".into(),account_kind:"checking".into(),
            opening_balance_in_cents:None,
        };
        let account_id = complete_onboarding_impl(onboarding, &db).await.unwrap().account_id;
        let input = TransactionInput {
            id:None, account_id:account_id.clone(), date:"2026-06-10".into(),
            description:"Feira da semana".into(), amount_in_cents:-5000, category_id:None,
        };
        assert!(create_transaction_impl(input, &db).await.is_ok());
        let duplicate = TransactionInput {
            id:None, account_id, date:"2026-06-10".into(),
            description:"Feira da semana".into(), amount_in_cents:-5000, category_id:None,
        };
        assert!(create_transaction_impl(duplicate, &db).await.is_err());
    }
}
