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
mod recurring;
pub use recurring::*;
mod merchants;
pub use merchants::*;
mod net_worth;
pub use net_worth::*;
mod upcoming;
pub use upcoming::*;
mod budget;
pub use budget::*;
mod export;
pub use export::*;
mod reconciliation;
pub use reconciliation::*;
mod category_management;
pub use category_management::*;
mod data_quality;
pub use data_quality::*;
mod installments;
pub use installments::*;

use crate::{
    application::state::{AppState, ImportSession},
    domain::{
        categorization::{
            first_match, CategorizationInput, CategorizationRule, MovementType, RuleOperator,
        },
        category_compatibility::{
            is_category_compatible, is_rule_category_compatible, CategoryContext, CategoryKind,
        },
        import::{
            fingerprint, is_own_account_pix_description, is_pix_description, mapping_signature,
            needs_pix_merchant_identification, normalize_description, CsvColumnMapping,
            CsvMappingDraft, CsvMappingProfile, ImportCandidate, ImportSourceKind,
            SuggestionSource,
        },
        merchant::merchant_key,
        suggestion::{
            category_compatible, is_refund_description, shortlist_categories, suggest_from_history,
            CategoryDefinition, HistoricalCategoryStat, MerchantCategoryStat, SuggestionContext,
            SuggestionIndex,
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
pub struct Account {
    id: String,
    name: String,
    kind: String,
    balance_in_cents: i64,
}

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInput {
    from_account_id: String,
    to_account_id: String,
    date: String,
    amount_in_cents: i64,
    description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDetails {
    debit_transaction_id: String,
    credit_transaction_id: String,
    from_account_id: String,
    to_account_id: String,
    date: String,
    amount_in_cents: i64,
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    display_name: String,
    monthly_income_in_cents: Option<i64>,
    monthly_target_in_cents: Option<i64>,
    income_day: Option<i64>,
    income_day_rule: Option<String>,
    financial_goal: Option<String>,
    onboarding_start_mode: Option<String>,
    onboarding_completed_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    display_name: String,
    monthly_income_in_cents: Option<i64>,
    monthly_target_in_cents: Option<i64>,
    income_day: Option<i64>,
    income_day_rule: Option<String>,
    financial_goal: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingInput {
    display_name: String,
    monthly_target_in_cents: Option<i64>,
    financial_goal: String,
    onboarding_start_mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrap {
    profile: Option<UserProfile>,
    onboarding_completed: bool,
    account: Option<Account>,
    has_transactions: bool,
    has_imports: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingResult {
    profile: UserProfile,
    account_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    id: String,
    account_id: String,
    account_name: String,
    account_kind: String,
    date: String,
    description: String,
    original_description: Option<String>,
    is_imported: bool,
    amount_in_cents: i64,
    category_id: Option<String>,
    category: Option<String>,
    category_source: Option<String>,
    status: String,
    is_transfer_leg: bool,
    linked_kind: Option<String>,
}

/// Optional server-side filters + pagination for `list_transactions_page`.
/// All fields are optional; omitted/empty ones are simply not applied.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionFilter {
    month: Option<String>,
    start_month: Option<String>,
    end_month: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    source: Option<String>,
    account_id: Option<String>,
    category_id: Option<String>,
    merchant_key: Option<String>,
    uncategorized: Option<bool>,
    search: Option<String>,
    status: Option<String>,
    movement_type: Option<String>,
    min_abs_amount_in_cents: Option<i64>,
    max_abs_amount_in_cents: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionPage {
    items: Vec<Transaction>,
    total_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    income_in_cents: i64,
    expenses_in_cents: i64,
    investments_in_cents: i64,
    balance_in_cents: i64,
    transaction_count: i64,
    by_category: Vec<CategoryTotal>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    category: String,
    amount_in_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    id: String,
    parent_id: Option<String>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    kind: String,
    sort_order: i64,
    is_system: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    id: Option<String>,
    parent_id: Option<String>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    kind: String,
    sort_order: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleInput {
    id: Option<String>,
    name: String,
    priority: i64,
    enabled: bool,
    operator: RuleOperator,
    pattern: String,
    account_id: Option<String>,
    movement_type: MovementType,
    min_amount_in_cents: Option<i64>,
    max_amount_in_cents: Option<i64>,
    category_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleImpactItem {
    transaction_id: String,
    date: String,
    description: String,
    current_category: Option<String>,
    suggested_category: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleImpact {
    count: usize,
    sample: Vec<RuleImpactItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    session_id: String,
    file_name: String,
    candidates: Vec<ImportCandidate>,
}

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
pub enum TemplateKind {
    Bank,
    CreditCard,
}

fn operator_from(value: &str) -> RuleOperator {
    match value {
        "starts_with" => RuleOperator::StartsWith,
        "regex" => RuleOperator::Regex,
        _ => RuleOperator::Contains,
    }
}

fn movement_from(value: &str) -> MovementType {
    match value {
        "income" => MovementType::Income,
        "expense" => MovementType::Expense,
        "transfer" => MovementType::Transfer,
        _ => MovementType::Any,
    }
}

fn operator_str(value: &RuleOperator) -> &'static str {
    match value {
        RuleOperator::Contains => "contains",
        RuleOperator::StartsWith => "starts_with",
        RuleOperator::Regex => "regex",
    }
}

fn movement_str(value: &MovementType) -> &'static str {
    match value {
        MovementType::Any => "any",
        MovementType::Income => "income",
        MovementType::Expense => "expense",
        MovementType::Transfer => "transfer",
    }
}

fn rule_from_row(row: SqliteRow) -> CategorizationRule {
    CategorizationRule {
        id: row.get("id"),
        name: row.get("name"),
        priority: row.get("priority"),
        enabled: row.get::<i64, _>("enabled") != 0,
        operator: operator_from(row.get("operator")),
        pattern: row.get("pattern"),
        account_id: row.get("account_id"),
        movement_type: movement_from(row.get("movement_type")),
        min_amount_in_cents: row.get("min_amount_cents"),
        max_amount_in_cents: row.get("max_amount_cents"),
        category_id: row.get("category_id"),
        category_name: row.get("category_name"),
        use_count: row.get("use_count"),
        is_system: row.get::<i64, _>("is_system") != 0,
    }
}

pub(super) async fn load_rules(db: &SqlitePool) -> Result<Vec<CategorizationRule>, AppError> {
    let rows = sqlx::query(
        "SELECT r.*, c.name category_name FROM categorization_rules r
         JOIN categories c ON c.id=r.category_id
         WHERE r.deleted_at IS NULL ORDER BY r.priority, r.created_at",
    )
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(rule_from_row).collect())
}

async fn load_suggestion_categories(db: &SqlitePool) -> Result<Vec<CategoryDefinition>, AppError> {
    let rows = sqlx::query(
        "SELECT id,name,kind,sort_order FROM categories WHERE deleted_at IS NULL ORDER BY sort_order,name",
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| CategoryDefinition {
            id: row.get("id"),
            name: row.get("name"),
            kind: row.get("kind"),
            sort_order: row.get("sort_order"),
        })
        .collect())
}

async fn load_all_historical_category_stats(
    db: &SqlitePool,
) -> Result<Vec<HistoricalCategoryStat>, AppError> {
    let rows = sqlx::query(
        "SELECT t.merchant_key, t.category_id, c.name category_name, c.kind category_kind,
         COUNT(*) n, MAX(t.date) last_used
         FROM transactions t JOIN categories c ON c.id=t.category_id
         WHERE t.merchant_key IS NOT NULL AND t.deleted_at IS NULL AND c.deleted_at IS NULL
          AND t.category_source='manual'
         GROUP BY t.merchant_key, t.category_id",
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| HistoricalCategoryStat {
            merchant_key: row.get("merchant_key"),
            category_id: row.get("category_id"),
            category_name: row.get("category_name"),
            category_kind: row.get("category_kind"),
            count: row.get("n"),
            last_used: row.get("last_used"),
        })
        .collect())
}

/// Applies rule matches first (regra explícita sempre vence histórico), then — only for
/// candidates a rule didn't touch — looks up the merchant's categorization history in one
/// batched query and suggests a category when confident enough (`suggest_from_history`).
pub(super) async fn apply_category_suggestions(
    db: &SqlitePool,
    account_id: &str,
    rules: &[CategorizationRule],
    candidates: &mut [ImportCandidate],
) -> Result<(), AppError> {
    apply_category_suggestions_to(db, account_id, rules, candidates.iter_mut(), false).await
}

/// Same as `apply_category_suggestions`, but generic over any mutable iterator of candidates —
/// lets credit card import items (which wrap `ImportCandidate` inside a bigger struct) reuse it.
pub(super) async fn apply_category_suggestions_to<'a>(
    db: &SqlitePool,
    account_id: &str,
    rules: &[CategorizationRule],
    candidates: impl Iterator<Item = &'a mut ImportCandidate>,
    credit_card_context: bool,
) -> Result<(), AppError> {
    let mut candidates: Vec<&mut ImportCandidate> = candidates.collect();
    for candidate in candidates.iter_mut() {
        candidate.needs_merchant_identification =
            needs_pix_merchant_identification(&candidate.description);
        candidate.merchant_key = if candidate.needs_merchant_identification && !credit_card_context
        {
            String::new()
        } else {
            merchant_key(&candidate.normalized_description)
        };
        candidate.category_suggestions.clear();
        if let Some(rule) = first_match(
            rules,
            &CategorizationInput {
                account_id,
                normalized_description: &candidate.normalized_description,
                amount_in_cents: candidate.amount_in_cents,
            },
        ) {
            candidate.suggested_category_id = Some(rule.category_id.clone());
            candidate.suggested_category_name = rule.category_name.clone();
            candidate.suggested_rule_id = Some(rule.id.clone());
            candidate.suggested_rule_name = Some(rule.name.clone());
            candidate.suggestion_source = Some(SuggestionSource::Rule);
        }
    }
    let history = load_all_historical_category_stats(db).await?;
    let mut stats_by_merchant: HashMap<String, Vec<MerchantCategoryStat>> = HashMap::new();
    for row in &history {
        let stats = stats_by_merchant
            .entry(merchant_key(&row.merchant_key))
            .or_default();
        if let Some(existing) = stats
            .iter_mut()
            .find(|stat| stat.category_id == row.category_id)
        {
            existing.count += row.count;
            if row.last_used > existing.last_used {
                existing.last_used = row.last_used.clone();
            }
        } else {
            stats.push(MerchantCategoryStat {
                category_id: row.category_id.clone(),
                category_name: Some(row.category_name.clone()),
                category_kind: row.category_kind.clone(),
                count: row.count,
                last_used: row.last_used.clone(),
            });
        }
    }
    let context = if credit_card_context {
        SuggestionContext::CreditCard
    } else {
        SuggestionContext::Bank
    };
    for candidate in candidates.iter_mut() {
        if candidate.suggestion_source.is_some() {
            continue;
        }
        if candidate.is_pix && !credit_card_context {
            continue;
        }
        let key = &candidate.merchant_key;
        let Some(stats) = stats_by_merchant.get(key) else {
            continue;
        };
        let is_refund = is_refund_description(&candidate.normalized_description);
        if let Some(suggestion) =
            suggest_from_history(stats, candidate.amount_in_cents, context, is_refund)
        {
            candidate.suggested_category_id = Some(suggestion.category_id);
            candidate.suggested_category_name = suggestion.category_name;
            candidate.suggestion_source = Some(SuggestionSource::History);
        }
    }

    if candidates
        .iter()
        .all(|candidate| candidate.suggestion_source.is_some())
    {
        return Ok(());
    }
    let categories = load_suggestion_categories(db).await?;
    let index = SuggestionIndex::new(&history);
    for candidate in candidates.iter_mut() {
        if candidate.suggestion_source.is_some() {
            continue;
        }
        let is_refund = is_refund_description(&candidate.normalized_description);
        candidate.category_suggestions = shortlist_categories(
            &candidate.merchant_key,
            &candidate.normalized_description,
            candidate.amount_in_cents,
            context,
            is_refund,
            &categories,
            &index,
        );
    }
    Ok(())
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
    let columns =
        serde_json::from_str::<Vec<CsvColumnMapping>>(&row.get::<String, _>("columns_json"))
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
         ORDER BY created_at",
    )
    .bind(bank_signature)
    .bind(card_signature)
    .fetch_all(db)
    .await?;
    rows.into_iter().map(mapping_profile_from_row).collect()
}

fn validate_rule(input: &RuleInput) -> Result<(), AppError> {
    if input.name.trim().is_empty() || input.pattern.trim().is_empty() {
        return Err(AppError::Validation(
            "Nome e padrão da regra são obrigatórios".into(),
        ));
    }
    if input
        .min_amount_in_cents
        .zip(input.max_amount_in_cents)
        .is_some_and(|(min, max)| min > max)
    {
        return Err(AppError::Validation(
            "O valor mínimo não pode superar o máximo".into(),
        ));
    }
    if input.operator == RuleOperator::Regex {
        Regex::new(&input.pattern)
            .map_err(|_| AppError::Validation("Expressão regular inválida".into()))?;
    }
    Ok(())
}

async fn ensure_transactions_not_installments(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ids: &[String],
) -> Result<(), AppError> {
    for id in ids {
        let installment: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transaction_installments WHERE transaction_id=?",
        )
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
        if installment > 0 {
            return Err(AppError::Validation(
                "Parcelas devem ser alteradas pelo fluxo do parcelamento".into(),
            ));
        }
    }
    Ok(())
}

async fn ensure_transactions_not_invoice_payments(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ids: &[String],
) -> Result<(), AppError> {
    for id in ids {
        let payment: i64 = sqlx::query_scalar(
            "SELECT EXISTS(
               SELECT 1 FROM credit_card_invoice_items
               WHERE transaction_id=? AND line_kind='payment'
             )",
        )
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
        if payment != 0 {
            return Err(AppError::Validation(
                "Pagamentos de fatura devem ser alterados pelo fluxo da fatura".into(),
            ));
        }
    }
    Ok(())
}

async fn ensure_transactions_unlinked(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ids: &[String],
) -> Result<(), AppError> {
    for id in ids {
        let linked = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transaction_links WHERE debit_transaction_id=? OR credit_transaction_id=?",
        )
        .bind(id)
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
        if linked > 0 {
            return Err(AppError::Validation(
                "Transações vinculadas só podem ser alteradas pelo fluxo correspondente".into(),
            ));
        }
    }
    Ok(())
}

fn normalize_transaction_ids(ids: Vec<String>) -> Result<Vec<String>, AppError> {
    if ids.is_empty() {
        return Err(AppError::Validation(
            "Selecione ao menos uma transação".into(),
        ));
    }
    if ids.len() > 1000 {
        return Err(AppError::Validation(
            "Uma ação em massa aceita no máximo 1.000 transações".into(),
        ));
    }
    let mut seen = HashSet::new();
    let normalized: Vec<String> = ids
        .into_iter()
        .filter(|id| !id.trim().is_empty() && seen.insert(id.clone()))
        .collect();
    if normalized.is_empty() {
        return Err(AppError::Validation(
            "Nenhum identificador de transação válido".into(),
        ));
    }
    Ok(normalized)
}

fn validate_profile(
    display_name: &str,
    monthly_income_in_cents: Option<i64>,
    income_day: Option<i64>,
    income_day_rule: Option<&str>,
    financial_goal: Option<&str>,
) -> Result<(), AppError> {
    let name_length = display_name.trim().chars().count();
    if !(2..=80).contains(&name_length) {
        return Err(AppError::Validation(
            "O nome deve ter entre 2 e 80 caracteres".into(),
        ));
    }
    if monthly_income_in_cents.is_some_and(|income| income < 0) {
        return Err(AppError::Validation(
            "A renda mensal não pode ser negativa".into(),
        ));
    }
    if income_day.is_some_and(|day| !(1..=31).contains(&day)) {
        return Err(AppError::Validation(
            "O dia de recebimento deve estar entre 1 e 31".into(),
        ));
    }
    if income_day_rule.is_some_and(|rule| rule != "fifth_business_day") {
        return Err(AppError::Validation("Regra de recebimento inválida".into()));
    }
    if income_day.is_some() && income_day_rule.is_some() {
        return Err(AppError::Validation(
            "Escolha um dia fixo ou o 5º dia útil do mês".into(),
        ));
    }
    if financial_goal.is_some_and(|goal| {
        !["organize", "emergency_fund", "pay_debt", "save", "invest"].contains(&goal)
    }) {
        return Err(AppError::Validation("Objetivo financeiro inválido".into()));
    }
    Ok(())
}

fn validate_monthly_target(monthly_target_in_cents: Option<i64>) -> Result<(), AppError> {
    if monthly_target_in_cents.is_some_and(|target| target <= 0) {
        return Err(AppError::Validation(
            "O valor mensal deve ser maior que zero".into(),
        ));
    }
    Ok(())
}

fn validate_onboarding_start_mode(mode: &str) -> Result<(), AppError> {
    if !["import", "manual", "tour"].contains(&mode) {
        return Err(AppError::Validation("Forma de começar inválida".into()));
    }
    Ok(())
}

fn profile_from_row(row: SqliteRow) -> UserProfile {
    UserProfile {
        display_name: row.get("display_name"),
        monthly_income_in_cents: row.get("monthly_income_cents"),
        monthly_target_in_cents: row.get("monthly_target_cents"),
        income_day: row.get("income_day"),
        income_day_rule: row.get("income_day_rule"),
        financial_goal: row.get("financial_goal"),
        onboarding_start_mode: row.get("onboarding_start_mode"),
        onboarding_completed_at: row.get("onboarding_completed_at"),
    }
}

async fn sync_profile_savings_target(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    amount_in_cents: Option<i64>,
) -> Result<(), AppError> {
    match amount_in_cents {
        Some(amount) => {
            let updated = sqlx::query(
                "UPDATE financial_targets
                 SET amount_cents=?,enabled=1,deleted_at=NULL,updated_at=datetime('now')
                 WHERE is_profile_target=1",
            )
            .bind(amount)
            .execute(&mut **tx)
            .await?;
            if updated.rows_affected() == 0 {
                sqlx::query(
                    "INSERT INTO financial_targets(
                       id,kind,category_id,amount_cents,enabled,is_profile_target
                     ) VALUES('profile-monthly-savings','savings',NULL,?,1,1)
                     ON CONFLICT(id) DO UPDATE SET amount_cents=excluded.amount_cents,
                     enabled=1,is_profile_target=1,deleted_at=NULL,updated_at=datetime('now')",
                )
                .bind(amount)
                .execute(&mut **tx)
                .await?;
            }
        }
        None => {
            sqlx::query(
                "UPDATE financial_targets
                 SET enabled=0,deleted_at=COALESCE(deleted_at,datetime('now')),
                 updated_at=datetime('now')
                 WHERE is_profile_target=1",
            )
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

async fn load_profile(db: &SqlitePool) -> Result<Option<UserProfile>, AppError> {
    Ok(sqlx::query(
        "SELECT display_name,monthly_income_cents,
         NULLIF(COALESCE((
           SELECT amount_cents FROM financial_targets
           WHERE is_profile_target=1 AND enabled=1 AND deleted_at IS NULL LIMIT 1
         ),monthly_target_cents),0) monthly_target_cents,
         income_day,income_day_rule,
         financial_goal,onboarding_start_mode,onboarding_completed_at
         FROM user_profiles WHERE id='primary'",
    )
    .fetch_optional(db)
    .await?
    .map(profile_from_row))
}

async fn has_import_batches(db: &SqlitePool) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM import_batches LIMIT 1)")
            .fetch_one(db)
            .await?
            != 0,
    )
}

#[tauri::command]
pub async fn get_app_bootstrap(state: State<'_, AppState>) -> Result<AppBootstrap, AppError> {
    let profile = load_profile(&state.db).await?;
    let account_row = sqlx::query(
        "SELECT id,name,kind,(SELECT COALESCE(SUM(amount_cents),0) FROM transactions t
         WHERE t.account_id=a.id AND t.deleted_at IS NULL) balance
         FROM accounts a WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await?;
    let account = account_row.map(|r| Account {
        id: r.get("id"),
        name: r.get("name"),
        kind: r.get("kind"),
        balance_in_cents: r.get("balance"),
    });
    let has_transactions =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL")
            .fetch_one(&state.db)
            .await?
            > 0;
    let has_imports = has_import_batches(&state.db).await?;
    Ok(AppBootstrap {
        onboarding_completed: profile.is_some(),
        profile,
        account,
        has_transactions,
        has_imports,
    })
}

#[tauri::command]
pub async fn get_profile(state: State<'_, AppState>) -> Result<Option<UserProfile>, AppError> {
    load_profile(&state.db).await
}

#[tauri::command]
pub async fn save_profile(
    input: ProfileInput,
    state: State<'_, AppState>,
) -> Result<UserProfile, AppError> {
    save_profile_impl(input, &state.db).await
}

async fn save_profile_impl(input: ProfileInput, db: &SqlitePool) -> Result<UserProfile, AppError> {
    validate_profile(
        &input.display_name,
        input.monthly_income_in_cents,
        input.income_day,
        input.income_day_rule.as_deref(),
        input.financial_goal.as_deref(),
    )?;
    validate_monthly_target(input.monthly_target_in_cents)?;
    let mut tx = db.begin().await?;
    let result = sqlx::query(
        "UPDATE user_profiles SET display_name=?,monthly_income_cents=?,monthly_target_cents=?,
         income_day=?,income_day_rule=?,financial_goal=?,updated_at=datetime('now') WHERE id='primary'",
    )
    .bind(input.display_name.trim())
    .bind(input.monthly_income_in_cents)
    .bind(input.monthly_target_in_cents.unwrap_or(0))
    .bind(input.income_day)
    .bind(input.income_day_rule)
    .bind(input.financial_goal)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Validation(
            "Conclua o cadastro inicial antes de editar o perfil".into(),
        ));
    }
    sync_profile_savings_target(&mut tx, input.monthly_target_in_cents).await?;
    tx.commit().await?;
    load_profile(db)
        .await?
        .ok_or_else(|| AppError::Validation("Perfil não encontrado".into()))
}

#[tauri::command]
pub async fn complete_onboarding(
    input: OnboardingInput,
    state: State<'_, AppState>,
) -> Result<OnboardingResult, AppError> {
    complete_onboarding_impl(input, &state.db).await
}

async fn complete_onboarding_impl(
    input: OnboardingInput,
    db: &SqlitePool,
) -> Result<OnboardingResult, AppError> {
    validate_profile(
        &input.display_name,
        None,
        None,
        None,
        Some(&input.financial_goal),
    )?;
    validate_monthly_target(input.monthly_target_in_cents)?;
    validate_onboarding_start_mode(&input.onboarding_start_mode)?;

    let mut tx = db.begin().await?;
    let account_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM accounts WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Nenhuma conta ativa foi encontrada".into()))?;
    sqlx::query(
        "INSERT INTO user_profiles(
           id,display_name,monthly_target_cents,financial_goal,onboarding_start_mode,onboarding_completed_at
         )
         VALUES('primary',?,?,?,?,datetime('now'))
         ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
         monthly_target_cents=excluded.monthly_target_cents,
         financial_goal=excluded.financial_goal,
         onboarding_start_mode=excluded.onboarding_start_mode,
         onboarding_completed_at=excluded.onboarding_completed_at,
         updated_at=datetime('now')"
    )
    .bind(input.display_name.trim())
    .bind(input.monthly_target_in_cents.unwrap_or(0))
    .bind(input.financial_goal)
    .bind(input.onboarding_start_mode)
    .execute(&mut *tx)
    .await?;
    sync_profile_savings_target(&mut tx, input.monthly_target_in_cents).await?;
    tx.commit().await?;
    let profile = load_profile(db)
        .await?
        .ok_or_else(|| AppError::Validation("Perfil não encontrado".into()))?;
    Ok(OnboardingResult {
        profile,
        account_id,
    })
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, AppError> {
    let rows = sqlx::query("SELECT id,name,kind,(SELECT COALESCE(SUM(amount_cents),0) FROM transactions t WHERE t.account_id=a.id AND t.deleted_at IS NULL) balance FROM accounts a WHERE deleted_at IS NULL ORDER BY name").fetch_all(&state.db).await?;
    Ok(rows
        .into_iter()
        .map(|r| Account {
            id: r.get("id"),
            name: r.get("name"),
            kind: r.get("kind"),
            balance_in_cents: r.get("balance"),
        })
        .collect())
}

fn validate_account_name(name: &str) -> Result<(), AppError> {
    if !(2..=80).contains(&name.trim().chars().count()) {
        return Err(AppError::Validation(
            "O nome da conta deve ter entre 2 e 80 caracteres".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn create_account(
    name: String,
    kind: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    validate_account_name(&name)?;
    if !["checking", "savings", "cash", "credit_card"].contains(&kind.as_str()) {
        return Err(AppError::Validation("Tipo de conta inválido".into()));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,?)")
        .bind(&id)
        .bind(name.trim())
        .bind(&kind)
        .execute(&state.db)
        .await?;
    Ok(id)
}

#[tauri::command]
pub async fn rename_account(
    id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_account_name(&name)?;
    let result = sqlx::query("UPDATE accounts SET name=? WHERE id=? AND deleted_at IS NULL")
        .bind(name.trim())
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Validation("Conta não encontrada".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn archive_account(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let has_active_transactions = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE account_id=? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?
        > 0;
    if has_active_transactions {
        return Err(AppError::Validation(
            "A conta tem transações ativas; mova ou exclua essas transações antes de arquivá-la"
                .into(),
        ));
    }
    let remaining = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM accounts WHERE deleted_at IS NULL AND id!=?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;
    if remaining == 0 {
        return Err(AppError::Validation(
            "Mantenha ao menos uma conta ativa".into(),
        ));
    }
    let result = sqlx::query(
        "UPDATE accounts SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL",
    )
    .bind(id)
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Validation("Conta não encontrada".into()));
    }
    Ok(())
}

/// Shared WHERE clause for `list_transactions`/`list_transactions_page`. Every filter is bound
/// unconditionally (using `?N IS NULL OR ...` guards) so both the item query and the count query
/// can reuse the exact same bind sequence.
const TRANSACTION_FILTER_WHERE: &str = "
    t.deleted_at IS NULL
    AND NOT (
      a.kind='credit_card' AND t.amount_cents>0 AND t.category_id='credit-card-payment'
      AND EXISTS(
        SELECT 1 FROM transaction_links hidden_payment_link
        WHERE hidden_payment_link.kind='credit_card_payment'
          AND hidden_payment_link.credit_transaction_id=t.id
      )
    )
    AND (?1 IS NULL OR strftime('%Y-%m', t.date) = ?1)
    AND (?2 IS NULL OR strftime('%Y-%m', t.date) >= ?2)
    AND (?3 IS NULL OR strftime('%Y-%m', t.date) <= ?3)
    AND (?4='all' OR (?4='bank' AND a.kind!='credit_card') OR (?4='credit_card' AND a.kind='credit_card'))
    AND (?5 IS NULL OR t.account_id=?5)
    AND (?6 IS NULL OR t.category_id=?6)
    AND (?7=0 OR t.category_id IS NULL)
    AND (?8 IS NULL OR t.normalized_description LIKE ?8 OR t.description LIKE ?8
         OR UPPER(COALESCE(t.display_description,'')) LIKE ?8
         OR EXISTS(
           SELECT 1 FROM merchant_aliases search_alias
           WHERE search_alias.merchant_key=t.merchant_key
             AND UPPER(search_alias.display_name) LIKE ?8
         ))
    AND (?9 IS NULL OR t.date >= ?9)
    AND (?10 IS NULL OR t.date <= ?10)
    AND (?11 IS NULL OR t.status = ?11)
    AND (
        ?12 IS NULL
        OR (?12='income' AND t.amount_cents>0 AND COALESCE(c.kind,'') NOT IN ('transfer','investment'))
        OR (?12='expense' AND t.amount_cents<0 AND COALESCE(c.kind,'') NOT IN ('transfer','investment'))
        OR (?12='transfer' AND c.kind='transfer')
        OR (?12='investment' AND c.kind='investment')
    )
    AND (?13 IS NULL OR ABS(t.amount_cents) >= ?13)
    AND (?14 IS NULL OR ABS(t.amount_cents) <= ?14)
    AND (?15 IS NULL OR t.merchant_key = ?15)
";

fn bind_transaction_filter<'q>(
    mut query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    filter: &'q TransactionFilter,
    search_like: &'q Option<String>,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    let source = filter.source.as_deref().unwrap_or("all");
    let uncategorized = if filter.uncategorized.unwrap_or(false) {
        1i64
    } else {
        0i64
    };
    query = query
        .bind(&filter.month)
        .bind(&filter.start_month)
        .bind(&filter.end_month)
        .bind(source)
        .bind(&filter.account_id)
        .bind(&filter.category_id)
        .bind(uncategorized)
        .bind(search_like)
        .bind(&filter.start_date)
        .bind(&filter.end_date)
        .bind(&filter.status)
        .bind(&filter.movement_type)
        .bind(filter.min_abs_amount_in_cents)
        .bind(filter.max_abs_amount_in_cents)
        .bind(&filter.merchant_key);
    query
}

async fn query_transactions_page(
    db: &SqlitePool,
    filter: &TransactionFilter,
) -> Result<TransactionPage, AppError> {
    let search_like = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", normalize_description(s)));
    let limit = filter.limit.unwrap_or(100).clamp(1, 1000);
    let offset = filter.offset.unwrap_or(0).max(0);

    let count_sql = format!(
        "SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         LEFT JOIN merchant_aliases ma ON ma.merchant_key=t.merchant_key
         WHERE {TRANSACTION_FILTER_WHERE}"
    );
    let count_query = bind_transaction_filter(sqlx::query(&count_sql), filter, &search_like);
    let total_count: i64 = count_query.fetch_one(db).await?.get(0);

    let items_sql = format!(
        "SELECT t.id,t.account_id,a.name account_name,a.kind account_kind,t.date,
         COALESCE(t.display_description,ma.display_name,t.description) description,
         CASE WHEN t.import_batch_id IS NOT NULL THEN t.description END original_description,
         t.import_batch_id IS NOT NULL is_imported,t.amount_cents,t.category_id,
         COALESCE(c.name,'Sem categoria') category,t.category_source,t.status,
         EXISTS(
            SELECT 1 FROM transaction_links l
            WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id
         ) is_transfer_leg,
         COALESCE(
           (SELECT l.kind FROM transaction_links l
            WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id
            LIMIT 1),
           CASE WHEN EXISTS(
             SELECT 1 FROM credit_card_invoice_items x
             WHERE x.transaction_id=t.id AND x.line_kind='payment'
           ) THEN 'credit_card_payment' END
         ) linked_kind
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         LEFT JOIN merchant_aliases ma ON ma.merchant_key=t.merchant_key
         WHERE {TRANSACTION_FILTER_WHERE}
         ORDER BY t.date DESC, t.id DESC
         LIMIT ?16 OFFSET ?17"
    );
    let items_query = bind_transaction_filter(sqlx::query(&items_sql), filter, &search_like)
        .bind(limit)
        .bind(offset);
    let rows = items_query.fetch_all(db).await?;

    let items = rows
        .into_iter()
        .map(|r| Transaction {
            id: r.get("id"),
            account_id: r.get("account_id"),
            account_name: r.get("account_name"),
            account_kind: r.get("account_kind"),
            date: r.get("date"),
            description: r.get("description"),
            original_description: r.get("original_description"),
            is_imported: r.get::<i64, _>("is_imported") != 0,
            amount_in_cents: r.get("amount_cents"),
            category_id: r.get("category_id"),
            category: r.get("category"),
            category_source: r.get("category_source"),
            status: r.get("status"),
            is_transfer_leg: r.get::<i64, _>("is_transfer_leg") != 0,
            linked_kind: r.get("linked_kind"),
        })
        .collect();
    Ok(TransactionPage { items, total_count })
}

#[tauri::command]
pub async fn list_transactions_page(
    filter: TransactionFilter,
    state: State<'_, AppState>,
) -> Result<TransactionPage, AppError> {
    query_transactions_page(&state.db, &filter).await
}

/// Legacy shape kept for callers (e.g. the dashboard) that only need a month-bounded list without
/// pagination metadata.
#[tauri::command]
pub async fn list_transactions(
    month: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Transaction>, AppError> {
    let filter = TransactionFilter {
        month,
        limit: Some(1000),
        ..Default::default()
    };
    Ok(query_transactions_page(&state.db, &filter).await?.items)
}

#[tauri::command]
pub async fn dashboard_summary(
    month: Option<String>,
    state: State<'_, AppState>,
) -> Result<Summary, AppError> {
    let m = month.unwrap_or_else(|| chrono::Local::now().format("%Y-%m").to_string());
    // Reuses the same row-classification logic as `generate_financial_report` (reports.rs) so the
    // dashboard and the reports page never disagree — e.g. a credit-card refund (positive amount on
    // a credit_card account) must not count as income, and expense-kind categories with a positive
    // amount reduce expenses rather than adding income.
    let data = reports::dashboard_summary_data(&state.db, &m).await?;
    Ok(Summary {
        income_in_cents: data.income_in_cents,
        expenses_in_cents: data.expenses_in_cents,
        investments_in_cents: data.investments_in_cents,
        balance_in_cents: data.balance_in_cents,
        transaction_count: data.transaction_count,
        by_category: data
            .by_category
            .into_iter()
            .map(|(category, amount_in_cents)| CategoryTotal {
                category,
                amount_in_cents,
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, AppError> {
    let rows = sqlx::query("SELECT id,parent_id,name,color,icon,kind,sort_order,is_system FROM categories WHERE deleted_at IS NULL ORDER BY sort_order,name").fetch_all(&state.db).await?;
    Ok(rows
        .into_iter()
        .map(|r| Category {
            id: r.get("id"),
            parent_id: r.get("parent_id"),
            name: r.get("name"),
            color: r.get("color"),
            icon: r.get("icon"),
            kind: r.get("kind"),
            sort_order: r.get("sort_order"),
            is_system: r.get::<i64, _>("is_system") != 0,
        })
        .collect())
}

#[tauri::command]
pub async fn save_category(
    input: CategoryInput,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    if input.name.trim().is_empty()
        || !["income", "expense", "transfer", "investment"].contains(&input.kind.as_str())
    {
        return Err(AppError::Validation(
            "Nome e tipo válidos são obrigatórios".into(),
        ));
    }
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    if input.parent_id.as_deref() == Some(&id) {
        return Err(AppError::Validation(
            "Uma categoria não pode ser superior de si mesma".into(),
        ));
    }
    if let Some(parent_id) = &input.parent_id {
        let parent_kind = sqlx::query_scalar::<_, String>(
            "SELECT kind FROM categories WHERE id=? AND deleted_at IS NULL",
        )
        .bind(parent_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::Validation("Categoria superior não encontrada".into()))?;
        if parent_kind != input.kind {
            return Err(AppError::Validation(
                "Categoria e categoria superior precisam ter o mesmo tipo".into(),
            ));
        }
        let creates_cycle = sqlx::query_scalar::<_,i64>(
            "WITH RECURSIVE ancestors(id,parent_id) AS (
             SELECT id,parent_id FROM categories WHERE id=?
             UNION ALL SELECT c.id,c.parent_id FROM categories c JOIN ancestors a ON c.id=a.parent_id
             ) SELECT COUNT(*) FROM ancestors WHERE id=?"
        ).bind(parent_id).bind(&id).fetch_one(&state.db).await? > 0;
        if creates_cycle {
            return Err(AppError::Validation(
                "A hierarquia escolhida criaria um ciclo".into(),
            ));
        }
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
    let is_system = sqlx::query_scalar::<_, i64>(
        "SELECT is_system FROM categories WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?
        != 0;
    if is_system {
        return Err(AppError::Validation(
            "Categorias essenciais do Lumen não podem ser arquivadas".into(),
        ));
    }
    let used_by_transactions = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?
        > 0;
    let used_by_rules = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM categorization_rules WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?
        > 0;
    let used_by_recurring = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recurring_transactions WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?
        > 0;
    let used_by_targets = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM financial_targets WHERE category_id=? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?
        > 0;
    let has_children = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM categories WHERE parent_id=? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?
        > 0;
    if used_by_transactions || used_by_rules || used_by_recurring || used_by_targets || has_children
    {
        return Err(AppError::Validation(
            "A categoria está em uso; una-a a outra categoria para preservar os vínculos".into(),
        ));
    }
    sqlx::query("UPDATE categories SET deleted_at=datetime('now') WHERE id=?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_rules(state: State<'_, AppState>) -> Result<Vec<CategorizationRule>, AppError> {
    load_rules(&state.db).await
}

#[tauri::command]
pub async fn save_rule(input: RuleInput, state: State<'_, AppState>) -> Result<String, AppError> {
    validate_rule(&input)?;
    let category_kind = sqlx::query_scalar::<_, String>(
        "SELECT kind FROM categories WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&input.category_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?;
    let category_kind = CategoryKind::from_str(&category_kind)
        .ok_or_else(|| AppError::Validation("Tipo de categoria inválido".into()))?;
    let configured_context = match input.movement_type {
        MovementType::Any => None,
        MovementType::Income => Some(CategoryContext::Income),
        MovementType::Expense => Some(CategoryContext::Expense),
        MovementType::Transfer => Some(CategoryContext::Transfer),
    };
    if configured_context.is_some_and(|context| !is_category_compatible(category_kind, context)) {
        return Err(AppError::Validation(
            "A categoria não é compatível com o tipo de movimento da regra".into(),
        ));
    }
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
    sqlx::query("UPDATE categorization_rules SET deleted_at=datetime('now'),enabled=0 WHERE id=?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn reorder_rules(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    for (index, id) in ids.into_iter().enumerate() {
        sqlx::query(
            "UPDATE categorization_rules SET priority=?,updated_at=datetime('now') WHERE id=?",
        )
        .bind((index as i64 + 1) * 10)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn calculate_impact(
    db: &SqlitePool,
    rule: &CategorizationRule,
    overwrite_manual: bool,
) -> Result<RuleImpact, AppError> {
    let category_kinds = load_active_category_kinds(db).await?;
    let rows = sqlx::query(
        "SELECT t.id,t.account_id,t.date,t.description,t.normalized_description,t.amount_cents,
                t.category_source,c.name current_category,a.kind account_kind
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM transaction_links l WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id)"
    ).fetch_all(db).await?;
    let mut sample = Vec::new();
    let mut count = 0;
    for row in rows {
        if !overwrite_manual
            && row.get::<Option<String>, _>("category_source").as_deref() == Some("manual")
        {
            continue;
        }
        let account_id: String = row.get("account_id");
        let description: String = row.get("normalized_description");
        let amount_in_cents: i64 = row.get("amount_cents");
        let account_kind: String = row.get("account_kind");
        if rule_is_compatible(rule, &category_kinds, &account_kind, amount_in_cents)
            && crate::domain::categorization::matches_rule(
                rule,
                &CategorizationInput {
                    account_id: &account_id,
                    normalized_description: &description,
                    amount_in_cents,
                },
            )
        {
            count += 1;
            if sample.len() < 10 {
                sample.push(RuleImpactItem {
                    transaction_id: row.get("id"),
                    date: row.get("date"),
                    description: row.get("description"),
                    current_category: row.get("current_category"),
                    suggested_category: rule
                        .category_name
                        .clone()
                        .unwrap_or_else(|| rule.category_id.clone()),
                });
            }
        }
    }
    Ok(RuleImpact { count, sample })
}

#[tauri::command]
pub async fn preview_rule(
    input: RuleInput,
    overwrite_manual: bool,
    state: State<'_, AppState>,
) -> Result<RuleImpact, AppError> {
    validate_rule(&input)?;
    let category_name = sqlx::query_scalar::<_, String>(
        "SELECT name FROM categories WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&input.category_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?;
    let rule = CategorizationRule {
        id: input.id.unwrap_or_default(),
        name: input.name,
        priority: input.priority,
        enabled: input.enabled,
        operator: input.operator,
        pattern: input.pattern,
        account_id: input.account_id,
        movement_type: input.movement_type,
        min_amount_in_cents: input.min_amount_in_cents,
        max_amount_in_cents: input.max_amount_in_cents,
        category_id: input.category_id,
        category_name: Some(category_name),
        use_count: 0,
        is_system: false,
    };
    calculate_impact(&state.db, &rule, overwrite_manual).await
}

#[tauri::command]
pub async fn preview_rules_retroactive(
    overwrite_manual: bool,
    state: State<'_, AppState>,
) -> Result<RuleImpact, AppError> {
    let rules = load_rules(&state.db).await?;
    let category_kinds = load_active_category_kinds(&state.db).await?;
    let rows = sqlx::query(
        "SELECT t.id,t.account_id,t.date,t.description,t.normalized_description,t.amount_cents,
         t.category_source,c.name current_category,a.kind account_kind
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM transaction_links l WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id)"
    ).fetch_all(&state.db).await?;
    let mut count = 0;
    let mut sample = Vec::new();
    for row in rows {
        if !overwrite_manual
            && row.get::<Option<String>, _>("category_source").as_deref() == Some("manual")
        {
            continue;
        }
        let account_id: String = row.get("account_id");
        let description: String = row.get("normalized_description");
        let amount_in_cents: i64 = row.get("amount_cents");
        let account_kind: String = row.get("account_kind");
        if let Some(rule) = first_match(
            &rules,
            &CategorizationInput {
                account_id: &account_id,
                normalized_description: &description,
                amount_in_cents,
            },
        )
        .filter(|rule| rule_is_compatible(rule, &category_kinds, &account_kind, amount_in_cents))
        {
            count += 1;
            if sample.len() < 10 {
                sample.push(RuleImpactItem {
                    transaction_id: row.get("id"),
                    date: row.get("date"),
                    description: row.get("description"),
                    current_category: row.get("current_category"),
                    suggested_category: rule
                        .category_name
                        .clone()
                        .unwrap_or_else(|| rule.category_id.clone()),
                });
            }
        }
    }
    Ok(RuleImpact { count, sample })
}

#[tauri::command]
pub async fn apply_rules_retroactive(
    overwrite_manual: bool,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    apply_rules_retroactive_impl(overwrite_manual, &state.db).await
}

async fn apply_rules_retroactive_impl(
    overwrite_manual: bool,
    db: &SqlitePool,
) -> Result<usize, AppError> {
    let rules = load_rules(db).await?;
    let category_kinds = load_active_category_kinds(db).await?;
    let rows = sqlx::query("SELECT t.id,t.account_id,t.normalized_description,t.amount_cents,t.category_source,a.kind account_kind FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_links l WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id)").fetch_all(db).await?;
    let mut tx = db.begin().await?;
    let mut count = 0;
    let mut rule_hits: HashMap<String, i64> = HashMap::new();
    for row in rows {
        if !overwrite_manual
            && row.get::<Option<String>, _>("category_source").as_deref() == Some("manual")
        {
            continue;
        }
        let account_id: String = row.get("account_id");
        let description: String = row.get("normalized_description");
        let amount_in_cents: i64 = row.get("amount_cents");
        let account_kind: String = row.get("account_kind");
        if let Some(rule) = first_match(
            &rules,
            &CategorizationInput {
                account_id: &account_id,
                normalized_description: &description,
                amount_in_cents,
            },
        )
        .filter(|rule| rule_is_compatible(rule, &category_kinds, &account_kind, amount_in_cents))
        {
            let transaction_id: String = row.get("id");
            let updated = sqlx::query(
                "UPDATE transactions SET category_id=?,category_source='rule',categorization_rule_id=?
                 WHERE id=? AND deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM transaction_links l
                                  WHERE l.debit_transaction_id=transactions.id
                                     OR l.credit_transaction_id=transactions.id)",
            )
            .bind(&rule.category_id)
            .bind(&rule.id)
            .bind(&transaction_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if updated == 1 {
                *rule_hits.entry(rule.id.clone()).or_insert(0) += 1;
                count += 1;
            }
        }
    }
    // Apply each rule's hit count in a single update to keep use_count consistent.
    for (rule_id, hits) in rule_hits {
        sqlx::query("UPDATE categorization_rules SET use_count=use_count+? WHERE id=?")
            .bind(hits)
            .bind(rule_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(count)
}

fn validate_transaction_input(input: &TransactionInput) -> Result<(), AppError> {
    if input.amount_in_cents == 0 || input.amount_in_cents == i64::MIN {
        return Err(AppError::Validation(
            "O valor da transação não pode ser zero".into(),
        ));
    }
    let description_length = input.description.trim().chars().count();
    if !(1..=200).contains(&description_length) {
        return Err(AppError::Validation(
            "A descrição deve ter entre 1 e 200 caracteres".into(),
        ));
    }
    chrono::NaiveDate::parse_from_str(input.date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Data inválida".into()))?;
    Ok(())
}

async fn ensure_account_active(db: &SqlitePool, account_id: &str) -> Result<(), AppError> {
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM accounts WHERE id=? AND deleted_at IS NULL",
    )
    .bind(account_id)
    .fetch_one(db)
    .await?
        > 0;
    if !exists {
        return Err(AppError::Validation("Conta não encontrada".into()));
    }
    Ok(())
}

fn transaction_category_context(account_kind: &str, amount_in_cents: i64) -> CategoryContext {
    if account_kind == "credit_card" {
        if amount_in_cents > 0 {
            CategoryContext::CreditCardRefund
        } else {
            CategoryContext::CreditCardCharge
        }
    } else if amount_in_cents > 0 {
        CategoryContext::Income
    } else {
        CategoryContext::Expense
    }
}

fn rule_context(value: &MovementType) -> CategoryContext {
    match value {
        MovementType::Any => CategoryContext::RuleAny,
        MovementType::Income => CategoryContext::Income,
        MovementType::Expense => CategoryContext::Expense,
        MovementType::Transfer => CategoryContext::Transfer,
    }
}

async fn load_active_category_kinds(
    db: &SqlitePool,
) -> Result<HashMap<String, CategoryKind>, AppError> {
    sqlx::query("SELECT id,kind FROM categories WHERE deleted_at IS NULL")
        .fetch_all(db)
        .await?
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let kind: String = row.get("kind");
            CategoryKind::from_str(&kind)
                .map(|kind| (id, kind))
                .ok_or_else(|| AppError::Validation("Tipo de categoria inválido".into()))
        })
        .collect()
}

fn rule_is_compatible(
    rule: &CategorizationRule,
    category_kinds: &HashMap<String, CategoryKind>,
    account_kind: &str,
    amount_in_cents: i64,
) -> bool {
    category_kinds.get(&rule.category_id).is_some_and(|kind| {
        is_rule_category_compatible(
            *kind,
            rule_context(&rule.movement_type),
            transaction_category_context(account_kind, amount_in_cents),
        )
    })
}

async fn ensure_transaction_category_compatible(
    db: &SqlitePool,
    category_id: &Option<String>,
    account_id: &str,
    amount_in_cents: i64,
) -> Result<(), AppError> {
    let Some(category_id) = category_id else {
        return Ok(());
    };
    let row = sqlx::query(
        "SELECT c.kind category_kind,a.kind account_kind
         FROM categories c CROSS JOIN accounts a
         WHERE c.id=? AND c.deleted_at IS NULL AND a.id=? AND a.deleted_at IS NULL",
    )
    .bind(category_id)
    .bind(account_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::Validation("Conta ou categoria não encontrada".into()))?;
    let kind: String = row.get("category_kind");
    let kind = CategoryKind::from_str(&kind)
        .ok_or_else(|| AppError::Validation("Tipo de categoria inválido".into()))?;
    let account_kind: String = row.get("account_kind");
    if !is_category_compatible(
        kind,
        transaction_category_context(&account_kind, amount_in_cents),
    ) {
        return Err(AppError::Validation(
            "A categoria não é compatível com este lançamento".into(),
        ));
    }
    Ok(())
}

/// Builds the deduplication fingerprint for a manually-entered transaction,
/// reusing the same logic as the importer (ADR 0002).
fn manual_fingerprint(
    account_id: &str,
    date: &str,
    description: &str,
    normalized: &str,
    amount_in_cents: i64,
) -> String {
    let candidate = ImportCandidate {
        source_row: 0,
        date: date.to_string(),
        description: description.to_string(),
        normalized_description: normalized.to_string(),
        is_pix: is_pix_description(description),
        is_own_account_pix: is_own_account_pix_description(description),
        needs_merchant_identification: needs_pix_merchant_identification(description),
        amount_in_cents,
        external_id: None,
        suggested_category_id: None,
        suggested_category_name: None,
        suggested_rule_id: None,
        suggested_rule_name: None,
        suggestion_source: None,
        merchant_key: String::new(),
        category_suggestions: vec![],
        duplicate_status: crate::domain::import::DuplicateStatus::New,
        warnings: vec![],
        included: true,
    };
    fingerprint(account_id, &candidate)
}

#[tauri::command]
pub async fn create_transaction(
    input: TransactionInput,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    create_transaction_impl(input, &state.db).await
}

async fn create_transaction_impl(
    input: TransactionInput,
    db: &SqlitePool,
) -> Result<String, AppError> {
    validate_transaction_input(&input)?;
    ensure_account_active(db, &input.account_id).await?;
    ensure_transaction_category_compatible(
        db,
        &input.category_id,
        &input.account_id,
        input.amount_in_cents,
    )
    .await?;
    let description = input.description.trim().to_string();
    let normalized = normalize_description(&description);
    let merchant = merchant_key(&normalized);
    let date = input.date.trim().to_string();
    let fp = manual_fingerprint(
        &input.account_id,
        &date,
        &description,
        &normalized,
        input.amount_in_cents,
    );
    let collides = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND deleted_at IS NULL",
    )
    .bind(&fp)
    .fetch_one(db)
    .await?
        > 0;
    if collides {
        return Err(AppError::Validation(
            "Já existe uma transação idêntica (mesma conta, data, descrição e valor)".into(),
        ));
    }
    let id = Uuid::new_v4().to_string();
    let source = input.category_id.as_ref().map(|_| "manual");
    sqlx::query(
        "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,fingerprint,category_id,category_source,status)
         VALUES(?,?,?,?,?,?,?,?,?,?,'cleared')"
    ).bind(&id).bind(&input.account_id).bind(&date).bind(&description).bind(&normalized).bind(&merchant)
        .bind(input.amount_in_cents).bind(&fp).bind(&input.category_id).bind(source)
        .execute(db).await?;
    Ok(id)
}

/// System category that keeps transfer legs out of income/expense totals.
const TRANSFER_CATEGORY_ID: &str = "transfers";

#[tauri::command]
pub async fn create_transfer(
    input: TransferInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    create_transfer_impl(input, &state.db).await
}

async fn create_transfer_impl(
    input: TransferInput,
    db: &SqlitePool,
) -> Result<Vec<String>, AppError> {
    if input.amount_in_cents <= 0 {
        return Err(AppError::Validation(
            "O valor da transferência deve ser maior que zero".into(),
        ));
    }
    if input.from_account_id == input.to_account_id {
        return Err(AppError::Validation(
            "Escolha contas diferentes para origem e destino".into(),
        ));
    }
    let date = input.date.trim().to_string();
    chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Data inválida".into()))?;
    ensure_account_active(db, &input.from_account_id).await?;
    ensure_account_active(db, &input.to_account_id).await?;
    let from_name = sqlx::query_scalar::<_, String>("SELECT name FROM accounts WHERE id=?")
        .bind(&input.from_account_id)
        .fetch_one(db)
        .await?;
    let to_name = sqlx::query_scalar::<_, String>("SELECT name FROM accounts WHERE id=?")
        .bind(&input.to_account_id)
        .fetch_one(db)
        .await?;
    let custom = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty());
    if let Some(d) = custom {
        if d.chars().count() > 180 {
            return Err(AppError::Validation(
                "A descrição deve ter no máximo 180 caracteres".into(),
            ));
        }
    }
    let out_description = custom
        .map(|d| format!("{d} (para {to_name})"))
        .unwrap_or_else(|| format!("Transferência para {to_name}"));
    let in_description = custom
        .map(|d| format!("{d} (de {from_name})"))
        .unwrap_or_else(|| format!("Transferência de {from_name}"));

    let legs = [
        (
            &input.from_account_id,
            out_description,
            -input.amount_in_cents,
        ),
        (&input.to_account_id, in_description, input.amount_in_cents),
    ];
    let mut tx = db.begin().await?;
    let mut ids = Vec::with_capacity(2);
    for (account_id, description, amount) in legs {
        let normalized = normalize_description(&description);
        let merchant = merchant_key(&normalized);
        let fp = manual_fingerprint(account_id, &date, &description, &normalized, amount);
        let collides = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND deleted_at IS NULL",
        )
        .bind(&fp)
        .fetch_one(&mut *tx)
        .await?
            > 0;
        if collides {
            return Err(AppError::Validation(
                "Já existe uma transferência idêntica (mesmas contas, data e valor)".into(),
            ));
        }
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,fingerprint,category_id,category_source,status)
             VALUES(?,?,?,?,?,?,?,?,?,'manual','cleared')"
        ).bind(&id).bind(account_id).bind(&date).bind(&description).bind(&normalized).bind(&merchant)
            .bind(amount).bind(&fp).bind(TRANSFER_CATEGORY_ID)
            .execute(&mut *tx).await?;
        ids.push(id);
    }
    // `ids[0]` is the out leg (negative amount, from_account) and `ids[1]` is the in leg
    // (positive amount, to_account) — see the `legs` array above. Linking them lets
    // `is_transfer_leg` (list_transactions_page/update_transaction_impl) protect both sides
    // from independent amount/date edits, the same way credit-card payment legs are protected.
    sqlx::query(
        "INSERT INTO transaction_links(id,kind,debit_transaction_id,credit_transaction_id)
         VALUES(?,'transfer',?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&ids[0])
    .bind(&ids[1])
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ids)
}

fn transfer_descriptions(
    custom_description: Option<&str>,
    from_name: &str,
    to_name: &str,
) -> Result<(String, String), AppError> {
    let custom = custom_description
        .map(str::trim)
        .filter(|description| !description.is_empty());
    if custom.is_some_and(|description| description.chars().count() > 180) {
        return Err(AppError::Validation(
            "A descrição deve ter no máximo 180 caracteres".into(),
        ));
    }
    Ok((
        custom
            .map(|description| format!("{description} (para {to_name})"))
            .unwrap_or_else(|| format!("Transferência para {to_name}")),
        custom
            .map(|description| format!("{description} (de {from_name})"))
            .unwrap_or_else(|| format!("Transferência de {from_name}")),
    ))
}

#[tauri::command]
pub async fn get_transfer_details(
    transaction_id: String,
    state: State<'_, AppState>,
) -> Result<TransferDetails, AppError> {
    get_transfer_details_impl(&transaction_id, &state.db).await
}

async fn get_transfer_details_impl(
    transaction_id: &str,
    db: &SqlitePool,
) -> Result<TransferDetails, AppError> {
    let row = sqlx::query(
        "SELECT l.debit_transaction_id,l.credit_transaction_id,
                debit.account_id from_account_id,credit.account_id to_account_id,
                debit.date,debit.amount_cents,debit.description,
                destination.name to_account_name
         FROM transaction_links l
         JOIN transactions debit ON debit.id=l.debit_transaction_id
         JOIN transactions credit ON credit.id=l.credit_transaction_id
         JOIN accounts destination ON destination.id=credit.account_id
         WHERE l.kind='transfer'
           AND (l.debit_transaction_id=? OR l.credit_transaction_id=?)",
    )
    .bind(transaction_id)
    .bind(transaction_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::Validation("Transferência não encontrada".into()))?;
    let description: String = row.get("description");
    let to_account_name: String = row.get("to_account_name");
    let default_description = format!("Transferência para {to_account_name}");
    let suffix = format!(" (para {to_account_name})");
    let custom_description = if description == default_description {
        None
    } else {
        description
            .strip_suffix(&suffix)
            .map(str::to_string)
            .or(Some(description))
    };
    let debit_amount: i64 = row.get("amount_cents");
    let amount_in_cents = debit_amount.checked_abs().ok_or_else(|| {
        AppError::Validation("O valor armazenado para esta transferência é inválido".into())
    })?;
    Ok(TransferDetails {
        debit_transaction_id: row.get("debit_transaction_id"),
        credit_transaction_id: row.get("credit_transaction_id"),
        from_account_id: row.get("from_account_id"),
        to_account_id: row.get("to_account_id"),
        date: row.get("date"),
        amount_in_cents,
        description: custom_description,
    })
}

#[tauri::command]
pub async fn update_transfer(
    transaction_id: String,
    input: TransferInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_transfer_impl(&transaction_id, input, &state.db).await
}

async fn update_transfer_impl(
    transaction_id: &str,
    input: TransferInput,
    db: &SqlitePool,
) -> Result<(), AppError> {
    if input.amount_in_cents <= 0 {
        return Err(AppError::Validation(
            "O valor da transferência deve ser maior que zero".into(),
        ));
    }
    if input.from_account_id == input.to_account_id {
        return Err(AppError::Validation(
            "Escolha contas diferentes para origem e destino".into(),
        ));
    }
    let date = input.date.trim().to_string();
    chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Data inválida".into()))?;

    let mut tx = db.begin().await?;
    let link = sqlx::query(
        "SELECT debit_transaction_id,credit_transaction_id
         FROM transaction_links
         WHERE kind='transfer' AND (debit_transaction_id=? OR credit_transaction_id=?)",
    )
    .bind(transaction_id)
    .bind(transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Transferência não encontrada".into()))?;
    let debit_id: String = link.get("debit_transaction_id");
    let credit_id: String = link.get("credit_transaction_id");
    let from_name = sqlx::query_scalar::<_, String>(
        "SELECT name FROM accounts WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&input.from_account_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Conta de origem não encontrada ou arquivada".into()))?;
    let to_name = sqlx::query_scalar::<_, String>(
        "SELECT name FROM accounts WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&input.to_account_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Conta de destino não encontrada ou arquivada".into()))?;
    let (out_description, in_description) =
        transfer_descriptions(input.description.as_deref(), &from_name, &to_name)?;
    let legs = [
        (
            debit_id.as_str(),
            input.from_account_id.as_str(),
            out_description,
            -input.amount_in_cents,
        ),
        (
            credit_id.as_str(),
            input.to_account_id.as_str(),
            in_description,
            input.amount_in_cents,
        ),
    ];
    let mut updates = Vec::with_capacity(2);
    for (id, account_id, description, amount) in legs {
        let normalized = normalize_description(&description);
        let merchant = merchant_key(&normalized);
        let fp = manual_fingerprint(account_id, &date, &description, &normalized, amount);
        let collides = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transactions
             WHERE fingerprint=? AND id NOT IN (?,?) AND deleted_at IS NULL",
        )
        .bind(&fp)
        .bind(&debit_id)
        .bind(&credit_id)
        .fetch_one(&mut *tx)
        .await?
            > 0;
        if collides {
            return Err(AppError::Validation(
                "Já existe uma transferência idêntica (mesmas contas, data e valor)".into(),
            ));
        }
        updates.push((
            id.to_string(),
            account_id.to_string(),
            description,
            normalized,
            merchant,
            amount,
            fp,
        ));
    }
    for (id, account_id, description, normalized, merchant, amount, fp) in updates {
        let affected = sqlx::query(
            "UPDATE transactions
             SET account_id=?,date=?,description=?,normalized_description=?,merchant_key=?,
                 amount_cents=?,fingerprint=?,category_id=?,category_source='manual',
                 categorization_rule_id=NULL
             WHERE id=? AND deleted_at IS NULL",
        )
        .bind(account_id)
        .bind(&date)
        .bind(description)
        .bind(normalized)
        .bind(merchant)
        .bind(amount)
        .bind(fp)
        .bind(TRANSFER_CATEGORY_ID)
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if affected != 1 {
            return Err(AppError::Validation(
                "Não é possível editar uma transferência que está na lixeira".into(),
            ));
        }
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn unlink_transfer(
    transaction_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    unlink_transfer_impl(&transaction_id, &state.db).await
}

async fn unlink_transfer_impl(transaction_id: &str, db: &SqlitePool) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    let link = sqlx::query(
        "SELECT id,debit_transaction_id,credit_transaction_id,
                previous_category_id,previous_category_source,previous_rule_id,
                previous_credit_category_id,previous_credit_category_source,previous_credit_rule_id
         FROM transaction_links
         WHERE kind='transfer' AND (debit_transaction_id=? OR credit_transaction_id=?)",
    )
    .bind(transaction_id)
    .bind(transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Transferência não encontrada".into()))?;
    let link_id: String = link.get("id");
    let debit_id: String = link.get("debit_transaction_id");
    let credit_id: String = link.get("credit_transaction_id");
    sqlx::query(
        "UPDATE transactions
         SET category_id=?,category_source=?,categorization_rule_id=?
         WHERE id=?",
    )
    .bind(link.get::<Option<String>, _>("previous_category_id"))
    .bind(link.get::<Option<String>, _>("previous_category_source"))
    .bind(link.get::<Option<String>, _>("previous_rule_id"))
    .bind(debit_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE transactions
         SET category_id=?,category_source=?,categorization_rule_id=?
         WHERE id=?",
    )
    .bind(link.get::<Option<String>, _>("previous_credit_category_id"))
    .bind(link.get::<Option<String>, _>("previous_credit_category_source"))
    .bind(link.get::<Option<String>, _>("previous_credit_rule_id"))
    .bind(credit_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM transaction_links WHERE id=?")
        .bind(link_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn set_transfer_deleted(
    transaction_id: String,
    deleted: bool,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    set_transfer_deleted_impl(&transaction_id, deleted, &state.db).await
}

async fn set_transfer_deleted_impl(
    transaction_id: &str,
    deleted: bool,
    db: &SqlitePool,
) -> Result<usize, AppError> {
    let mut tx = db.begin().await?;
    let link = sqlx::query(
        "SELECT debit_transaction_id,credit_transaction_id
         FROM transaction_links
         WHERE kind='transfer' AND (debit_transaction_id=? OR credit_transaction_id=?)",
    )
    .bind(transaction_id)
    .bind(transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Transferência não encontrada".into()))?;
    let debit_id: String = link.get("debit_transaction_id");
    let credit_id: String = link.get("credit_transaction_id");
    if !deleted {
        for id in [&debit_id, &credit_id] {
            let row = sqlx::query(
                "SELECT t.fingerprint,a.deleted_at account_deleted_at
                 FROM transactions t JOIN accounts a ON a.id=t.account_id
                 WHERE t.id=?",
            )
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::Validation("Perna da transferência não encontrada".into()))?;
            if row.get::<Option<String>, _>("account_deleted_at").is_some() {
                return Err(AppError::Validation(
                    "Restaure as contas da transferência antes de restaurá-la".into(),
                ));
            }
            let fp: String = row.get("fingerprint");
            let collides = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM transactions
                 WHERE fingerprint=? AND id NOT IN (?,?) AND deleted_at IS NULL",
            )
            .bind(fp)
            .bind(&debit_id)
            .bind(&credit_id)
            .fetch_one(&mut *tx)
            .await?
                > 0;
            if collides {
                return Err(AppError::Validation(
                    "Não é possível restaurar: já existe uma transação idêntica ativa".into(),
                ));
            }
        }
    }
    let result = if deleted {
        sqlx::query(
            "UPDATE transactions SET deleted_at=datetime('now')
             WHERE id IN (?,?) AND deleted_at IS NULL",
        )
        .bind(&debit_id)
        .bind(&credit_id)
        .execute(&mut *tx)
        .await?
    } else {
        sqlx::query(
            "UPDATE transactions SET deleted_at=NULL
             WHERE id IN (?,?) AND deleted_at IS NOT NULL",
        )
        .bind(&debit_id)
        .bind(&credit_id)
        .execute(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(result.rows_affected() as usize)
}

/// Candidate pair of transactions that look like an unlinked account-to-account transfer:
/// opposite amounts, different (non-credit-card) accounts, dates within 3 days, and neither
/// side already categorized outside the transfers bucket or linked to another transaction.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferCandidate {
    debit_transaction_id: String,
    debit_account_name: String,
    debit_date: String,
    debit_description: String,
    credit_transaction_id: String,
    credit_account_name: String,
    credit_date: String,
    credit_description: String,
    amount_in_cents: i64,
}

#[tauri::command]
pub async fn detect_transfer_candidates(
    batch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<TransferCandidate>, AppError> {
    detect_transfer_candidates_impl(&state.db, batch_id.as_deref()).await
}

async fn detect_transfer_candidates_impl(
    db: &SqlitePool,
    batch_id: Option<&str>,
) -> Result<Vec<TransferCandidate>, AppError> {
    let rows = sqlx::query(
        "SELECT d.id debit_id, da.name debit_account_name, d.date debit_date, d.description debit_description,
                c.id credit_id, ca.name credit_account_name, c.date credit_date, c.description credit_description,
                c.amount_cents amount_cents
         FROM transactions d
         JOIN accounts da ON da.id=d.account_id
         JOIN transactions c ON c.amount_cents = -d.amount_cents
         JOIN accounts ca ON ca.id=c.account_id
         WHERE d.amount_cents<0 AND d.deleted_at IS NULL AND c.deleted_at IS NULL
           AND da.kind!='credit_card' AND ca.kind!='credit_card'
           AND d.account_id != c.account_id
           AND ABS(julianday(d.date)-julianday(c.date))<=3
           AND (d.category_id IS NULL OR d.category_id IN (SELECT id FROM categories WHERE kind='transfer'))
           AND (c.category_id IS NULL OR c.category_id IN (SELECT id FROM categories WHERE kind='transfer'))
           AND NOT EXISTS(SELECT 1 FROM transaction_links l WHERE l.debit_transaction_id=d.id OR l.credit_transaction_id=d.id)
           AND NOT EXISTS(SELECT 1 FROM transaction_links l WHERE l.debit_transaction_id=c.id OR l.credit_transaction_id=c.id)
           AND (?1 IS NULL OR d.import_batch_id=?1 OR c.import_batch_id=?1)
         ORDER BY d.date DESC
         LIMIT 50",
    )
    .bind(batch_id)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| TransferCandidate {
            debit_transaction_id: r.get("debit_id"),
            debit_account_name: r.get("debit_account_name"),
            debit_date: r.get("debit_date"),
            debit_description: r.get("debit_description"),
            credit_transaction_id: r.get("credit_id"),
            credit_account_name: r.get("credit_account_name"),
            credit_date: r.get("credit_date"),
            credit_description: r.get("credit_description"),
            amount_in_cents: r.get("amount_cents"),
        })
        .collect())
}

#[tauri::command]
pub async fn link_transfer_pair(
    debit_transaction_id: String,
    credit_transaction_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    link_transfer_pair_impl(debit_transaction_id, credit_transaction_id, &state.db).await
}

async fn link_transfer_pair_impl(
    debit_transaction_id: String,
    credit_transaction_id: String,
    db: &SqlitePool,
) -> Result<(), AppError> {
    if debit_transaction_id == credit_transaction_id {
        return Err(AppError::Validation(
            "Selecione duas transações diferentes".into(),
        ));
    }
    let mut tx = db.begin().await?;
    let debit = sqlx::query(
        "SELECT t.amount_cents,t.account_id,t.category_id,t.category_source,t.categorization_rule_id
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind!='credit_card'",
    )
    .bind(&debit_transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Transação de origem não encontrada".into()))?;
    let credit = sqlx::query(
        "SELECT t.amount_cents,t.account_id,t.category_id,t.category_source,t.categorization_rule_id
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind!='credit_card'",
    )
    .bind(&credit_transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Transação de destino não encontrada".into()))?;
    let debit_amount: i64 = debit.get("amount_cents");
    let credit_amount: i64 = credit.get("amount_cents");
    if debit_amount >= 0 || credit_amount <= 0 || debit_amount != -credit_amount {
        return Err(AppError::Validation(
            "Os dois lados da transferência precisam ter valores opostos".into(),
        ));
    }
    if debit.get::<String, _>("account_id") == credit.get::<String, _>("account_id") {
        return Err(AppError::Validation(
            "Escolha transações de contas diferentes".into(),
        ));
    }
    let already_linked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transaction_links
         WHERE debit_transaction_id IN (?,?) OR credit_transaction_id IN (?,?)",
    )
    .bind(&debit_transaction_id)
    .bind(&credit_transaction_id)
    .bind(&debit_transaction_id)
    .bind(&credit_transaction_id)
    .fetch_one(&mut *tx)
    .await?;
    if already_linked > 0 {
        return Err(AppError::Validation(
            "Uma dessas transações já está vinculada a outra transferência ou pagamento".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO transaction_links(
             id,kind,debit_transaction_id,credit_transaction_id,
             previous_category_id,previous_category_source,previous_rule_id,
             previous_credit_category_id,previous_credit_category_source,previous_credit_rule_id
         )
         VALUES(?,'transfer',?,?,?,?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&debit_transaction_id)
    .bind(&credit_transaction_id)
    .bind(debit.get::<Option<String>, _>("category_id"))
    .bind(debit.get::<Option<String>, _>("category_source"))
    .bind(debit.get::<Option<String>, _>("categorization_rule_id"))
    .bind(credit.get::<Option<String>, _>("category_id"))
    .bind(credit.get::<Option<String>, _>("category_source"))
    .bind(credit.get::<Option<String>, _>("categorization_rule_id"))
    .execute(&mut *tx)
    .await?;
    for transaction_id in [&debit_transaction_id, &credit_transaction_id] {
        sqlx::query(
            "UPDATE transactions SET category_id=?,category_source='manual',categorization_rule_id=NULL WHERE id=?",
        )
        .bind(TRANSFER_CATEGORY_ID)
        .bind(transaction_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn update_transaction(
    input: TransactionInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_transaction_impl(input, &state.db).await
}

async fn update_transaction_impl(input: TransactionInput, db: &SqlitePool) -> Result<(), AppError> {
    let id = input
        .id
        .clone()
        .ok_or_else(|| AppError::Validation("Transação inválida".into()))?;
    validate_transaction_input(&input)?;
    ensure_account_active(db, &input.account_id).await?;
    let description = input.description.trim().to_string();
    let date = input.date.trim().to_string();
    let mut tx = db.begin().await?;
    ensure_transactions_not_invoice_payments(&mut tx, std::slice::from_ref(&id)).await?;
    let current = sqlx::query(
        "SELECT t.account_id,t.date,t.description,t.normalized_description,t.display_description,
         COALESCE(t.display_description,ma.display_name,t.description) resolved_description,
         t.amount_cents,t.category_id,t.import_batch_id,
         EXISTS(SELECT 1 FROM transaction_links l
                WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id) is_transfer_leg,
         EXISTS(SELECT 1 FROM transaction_installments i WHERE i.transaction_id=t.id) is_installment
         FROM transactions t
         LEFT JOIN merchant_aliases ma ON ma.merchant_key=t.merchant_key
         WHERE t.id=? AND t.deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Transação não encontrada".into()))?;
    let protected_fields_changed = current.get::<String, _>("account_id") != input.account_id
        || current.get::<String, _>("date") != input.date.trim()
        || current.get::<i64, _>("amount_cents") != input.amount_in_cents;
    if current.get::<i64, _>("is_installment") != 0 && protected_fields_changed {
        return Err(AppError::Validation(
            "Valor, data e conta de parcelas devem ser alterados pelo fluxo do parcelamento".into(),
        ));
    }
    let is_transfer_leg = current.get::<i64, _>("is_transfer_leg") != 0;
    let is_imported = current
        .get::<Option<String>, _>("import_batch_id")
        .is_some();
    if is_transfer_leg {
        let current_account: String = current.get("account_id");
        let current_date: String = current.get("date");
        let current_amount: i64 = current.get("amount_cents");
        let current_category: Option<String> = current.get("category_id");
        if current_account != input.account_id
            || current_date != input.date.trim()
            || current_amount != input.amount_in_cents
            || current_category != input.category_id
        {
            return Err(AppError::Validation(
                "Esta transação está vinculada; edite valor, data, conta ou categoria pelo fluxo correspondente".into(),
            ));
        }
    } else {
        ensure_transaction_category_compatible(
            db,
            &input.category_id,
            &input.account_id,
            input.amount_in_cents,
        )
        .await?;
    }
    let original_description: String = current.get("description");
    let normalized = if is_imported {
        current.get("normalized_description")
    } else {
        normalize_description(&description)
    };
    let fp = manual_fingerprint(
        &input.account_id,
        &date,
        if is_imported {
            &original_description
        } else {
            &description
        },
        &normalized,
        input.amount_in_cents,
    );
    let collides = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND id!=? AND deleted_at IS NULL",
    )
    .bind(&fp)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?
        > 0;
    if collides {
        return Err(AppError::Validation(
            "Já existe uma transação idêntica (mesma conta, data, descrição e valor)".into(),
        ));
    }
    let source = input.category_id.as_ref().map(|_| "manual");
    if is_imported {
        let current_display_description: Option<String> = current.get("display_description");
        let resolved_description: String = current.get("resolved_description");
        let display_description = if description == resolved_description {
            current_display_description
        } else {
            (description != original_description).then_some(description)
        };
        sqlx::query(
            "UPDATE transactions SET account_id=?,date=?,display_description=?,amount_cents=?,
             fingerprint=?,category_id=?,category_source=?,categorization_rule_id=NULL
             WHERE id=? AND deleted_at IS NULL",
        )
        .bind(&input.account_id)
        .bind(&date)
        .bind(display_description)
        .bind(input.amount_in_cents)
        .bind(&fp)
        .bind(&input.category_id)
        .bind(source)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    } else {
        let merchant = merchant_key(&normalized);
        sqlx::query(
            "UPDATE transactions SET account_id=?,date=?,description=?,normalized_description=?,merchant_key=?,amount_cents=?,
             fingerprint=?,category_id=?,category_source=?,categorization_rule_id=NULL
             WHERE id=? AND deleted_at IS NULL",
        )
        .bind(&input.account_id)
        .bind(&date)
        .bind(&description)
        .bind(&normalized)
        .bind(&merchant)
        .bind(input.amount_in_cents)
        .bind(&fp)
        .bind(&input.category_id)
        .bind(source)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn update_transaction_category(
    transaction_id: String,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_transaction_category_impl(transaction_id, category_id, &state.db).await
}

async fn update_transaction_category_impl(
    transaction_id: String,
    category_id: Option<String>,
    db: &SqlitePool,
) -> Result<(), AppError> {
    let transaction = sqlx::query(
        "SELECT account_id,amount_cents FROM transactions
         WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&transaction_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::Validation("Transação não encontrada".into()))?;
    let account_id: String = transaction.get("account_id");
    let amount_in_cents: i64 = transaction.get("amount_cents");
    ensure_transaction_category_compatible(db, &category_id, &account_id, amount_in_cents).await?;
    let mut tx = db.begin().await?;
    ensure_transactions_not_invoice_payments(&mut tx, std::slice::from_ref(&transaction_id))
        .await?;
    ensure_transactions_unlinked(&mut tx, std::slice::from_ref(&transaction_id)).await?;
    sqlx::query("UPDATE transactions SET category_id=?,category_source='manual',categorization_rule_id=NULL WHERE id=? AND deleted_at IS NULL")
        .bind(category_id).bind(transaction_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn update_transaction_amount(
    transaction_id: String,
    amount_in_cents: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_transaction_amount_impl(transaction_id, amount_in_cents, &state.db).await
}

async fn update_transaction_amount_impl(
    transaction_id: String,
    amount_in_cents: i64,
    db: &SqlitePool,
) -> Result<(), AppError> {
    if amount_in_cents == 0 || amount_in_cents == i64::MIN {
        return Err(AppError::Validation(
            "O valor da transação não pode ser zero".into(),
        ));
    }
    let mut tx = db.begin().await?;
    ensure_transactions_not_invoice_payments(&mut tx, std::slice::from_ref(&transaction_id))
        .await?;
    ensure_transactions_unlinked(&mut tx, std::slice::from_ref(&transaction_id)).await?;
    let row = sqlx::query(
        "SELECT account_id,date,description,normalized_description,external_id,category_id
         FROM transactions WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Transação não encontrada".into()))?;
    let candidate = ImportCandidate {
        source_row: 0,
        date: row.get("date"),
        description: row.get("description"),
        normalized_description: row.get("normalized_description"),
        is_pix: is_pix_description(row.get::<String, _>("description").as_str()),
        is_own_account_pix: is_own_account_pix_description(
            row.get::<String, _>("description").as_str(),
        ),
        needs_merchant_identification: needs_pix_merchant_identification(
            &row.get::<String, _>("description"),
        ),
        amount_in_cents,
        external_id: row.get("external_id"),
        suggested_category_id: None,
        suggested_category_name: None,
        suggested_rule_id: None,
        suggested_rule_name: None,
        suggestion_source: None,
        merchant_key: String::new(),
        category_suggestions: vec![],
        duplicate_status: crate::domain::import::DuplicateStatus::New,
        warnings: vec![],
        included: true,
    };
    let account_id: String = row.get("account_id");
    let category_id: Option<String> = row.get("category_id");
    ensure_transaction_category_compatible(db, &category_id, &account_id, amount_in_cents).await?;
    ensure_transactions_not_installments(&mut tx, std::slice::from_ref(&transaction_id)).await?;
    let fp = fingerprint(&account_id, &candidate);
    let collides = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND id!=? AND deleted_at IS NULL",
    )
    .bind(&fp)
    .bind(&transaction_id)
    .fetch_one(&mut *tx)
    .await?
        > 0;
    if collides {
        return Err(AppError::Validation(
            "Esse valor deixaria a transação idêntica a outra já existente".into(),
        ));
    }
    sqlx::query("UPDATE transactions SET amount_cents=?,fingerprint=? WHERE id=?")
        .bind(amount_in_cents)
        .bind(&fp)
        .bind(transaction_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn set_transaction_status(
    transaction_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    set_transaction_status_impl(transaction_id, status, &state.db).await
}

async fn set_transaction_status_impl(
    transaction_id: String,
    status: String,
    db: &SqlitePool,
) -> Result<(), AppError> {
    if !["pending", "cleared"].contains(&status.as_str()) {
        return Err(AppError::Validation("Status de transação inválido".into()));
    }
    let mut tx = db.begin().await?;
    ensure_transactions_not_invoice_payments(&mut tx, std::slice::from_ref(&transaction_id))
        .await?;
    ensure_transactions_unlinked(&mut tx, std::slice::from_ref(&transaction_id)).await?;
    ensure_transactions_not_installments(&mut tx, std::slice::from_ref(&transaction_id)).await?;
    let changed = sqlx::query("UPDATE transactions SET status=? WHERE id=? AND deleted_at IS NULL")
        .bind(status)
        .bind(transaction_id)
        .execute(&mut *tx)
        .await?;
    if changed.rows_affected() == 0 {
        return Err(AppError::Validation("Transação não encontrada".into()));
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn bulk_update_transaction_category(
    transaction_ids: Vec<String>,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    bulk_update_transaction_category_impl(transaction_ids, category_id, &state.db).await
}

async fn bulk_update_transaction_category_impl(
    transaction_ids: Vec<String>,
    category_id: Option<String>,
    db: &SqlitePool,
) -> Result<usize, AppError> {
    let ids = normalize_transaction_ids(transaction_ids)?;
    for id in &ids {
        let transaction = sqlx::query(
            "SELECT account_id,amount_cents FROM transactions
             WHERE id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::Validation("Transação não encontrada".into()))?;
        let account_id: String = transaction.get("account_id");
        let amount_in_cents: i64 = transaction.get("amount_cents");
        ensure_transaction_category_compatible(db, &category_id, &account_id, amount_in_cents)
            .await?;
    }
    let mut tx = db.begin().await?;
    ensure_transactions_not_invoice_payments(&mut tx, &ids).await?;
    ensure_transactions_unlinked(&mut tx, &ids).await?;
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
pub async fn delete_transactions(
    transaction_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    delete_transactions_impl(transaction_ids, &state.db).await
}

async fn delete_transactions_impl(
    transaction_ids: Vec<String>,
    db: &SqlitePool,
) -> Result<usize, AppError> {
    let ids = normalize_transaction_ids(transaction_ids)?;
    let mut tx = db.begin().await?;
    ensure_transactions_not_invoice_payments(&mut tx, &ids).await?;
    ensure_transactions_unlinked(&mut tx, &ids).await?;
    ensure_transactions_not_installments(&mut tx, &ids).await?;
    let mut count = 0;
    for id in ids {
        count += sqlx::query(
            "UPDATE transactions SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as usize;
    }
    tx.commit().await?;
    Ok(count)
}

#[tauri::command]
pub async fn restore_transactions(
    transaction_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    restore_transactions_impl(transaction_ids, &state.db).await
}

async fn restore_transactions_impl(
    transaction_ids: Vec<String>,
    db: &SqlitePool,
) -> Result<usize, AppError> {
    let ids = normalize_transaction_ids(transaction_ids)?;
    let mut tx = db.begin().await?;
    ensure_transactions_unlinked(&mut tx, &ids).await?;
    let mut count = 0;
    for id in ids {
        // Refuse to restore a transaction whose fingerprint now matches an active one,
        // otherwise the restore would silently re-create a duplicate.
        if let Some(fp) = sqlx::query_scalar::<_, String>(
            "SELECT fingerprint FROM transactions WHERE id=? AND deleted_at IS NOT NULL",
        )
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        {
            let collides = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND id!=? AND deleted_at IS NULL"
            ).bind(&fp).bind(&id).fetch_one(&mut *tx).await? > 0;
            if collides {
                return Err(AppError::Validation(
                    "Não é possível restaurar: já existe uma transação idêntica ativa".into(),
                ));
            }
        }
        count += sqlx::query(
            "UPDATE transactions SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL",
        )
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as usize;
    }
    tx.commit().await?;
    Ok(count)
}

#[tauri::command]
pub async fn inspect_import_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<ImportFileInspection, AppError> {
    let path = PathBuf::from(&path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("arquivo")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
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
    let matched_profiles =
        list_matching_profiles(&state.db, &inspection.headers, &inspection.delimiter).await?;
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
pub async fn list_csv_mapping_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<CsvMappingProfile>, AppError> {
    let rows = sqlx::query(
        "SELECT id,name,source_kind,delimiter,date_format,decimal_separator,signature,columns_json
         FROM csv_mapping_profiles ORDER BY created_at",
    )
    .fetch_all(&state.db)
    .await?;
    rows.into_iter().map(mapping_profile_from_row).collect()
}

#[tauri::command]
pub async fn save_csv_mapping_profile(
    mapping: CsvMappingDraft,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    validate_mapping_draft(&mapping)?;
    let id = Uuid::new_v4().to_string();
    let signature = mapping_signature(
        &mapping
            .columns
            .iter()
            .map(|column| column.header.clone())
            .collect::<Vec<_>>(),
        &mapping.delimiter,
        mapping.source_kind,
    );
    let name = mapping
        .profile_name
        .clone()
        .unwrap_or_else(|| match mapping.source_kind {
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
            Err(AppError::Validation(
                "Já existe um layout salvo para esse conjunto de colunas e tipo".into(),
            ))
        }
        Err(error) => Err(AppError::Database(error)),
    }
}

#[tauri::command]
pub async fn delete_csv_mapping_profile(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM csv_mapping_profiles WHERE id=?")
        .bind(profile_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn export_import_template(
    path: String,
    template_kind: TemplateKind,
) -> Result<(), AppError> {
    std::fs::write(path, template_contents(&template_kind))?;
    Ok(())
}

#[tauri::command]
async fn reclassify_import_session(
    db: &SqlitePool,
    account_id: &str,
    candidates: &mut [ImportCandidate],
) -> Result<(), AppError> {
    let mut seen_external = HashSet::new();
    let mut seen_fingerprint = HashSet::new();
    for candidate in candidates.iter_mut() {
        let fp = fingerprint(account_id, candidate);
        let duplicate = if let Some(external) =
            candidate.external_id.as_deref().filter(|v| !v.is_empty())
        {
            !seen_external.insert(external.to_string()) || sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE account_id=? AND external_id=? AND deleted_at IS NULL").bind(account_id).bind(external).fetch_one(db).await? > 0
        } else {
            !seen_fingerprint.insert(fp.clone()) || sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE account_id=? AND fingerprint=? AND deleted_at IS NULL").bind(account_id).bind(fp).fetch_one(db).await? > 0
        };
        candidate.duplicate_status = if duplicate {
            crate::domain::import::DuplicateStatus::Exact
        } else {
            crate::domain::import::DuplicateStatus::New
        };
        if duplicate {
            candidate.included = false;
        }
    }
    Ok(())
}

async fn mark_import_duplicates(
    db: &SqlitePool,
    account_id: &str,
    candidates: &mut [ImportCandidate],
) -> Result<(), AppError> {
    let mut seen_external = HashSet::new();
    let mut seen_fingerprint = HashSet::new();
    for candidate in candidates {
        let fp = fingerprint(account_id, candidate);
        let external = candidate
            .external_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let duplicate = if let Some(external) = external {
            !seen_external.insert(external.to_string())
                || sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE account_id=? AND external_id=? AND deleted_at IS NULL")
                    .bind(account_id).bind(external).fetch_one(db).await? > 0
        } else {
            !seen_fingerprint.insert(fp.clone())
                || sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE account_id=? AND fingerprint=? AND deleted_at IS NULL")
                    .bind(account_id).bind(fp).fetch_one(db).await? > 0
        };
        if duplicate {
            candidate.duplicate_status = crate::domain::import::DuplicateStatus::Exact;
            candidate.included = false;
            candidate
                .warnings
                .push("Lançamento duplicado nesta conta".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_import(
    path: String,
    account_id: String,
    state: State<'_, AppState>,
) -> Result<ImportPreview, AppError> {
    let path = PathBuf::from(path);
    let mut candidates = parse_file(&path)?;
    let rules = load_rules(&state.db).await?;
    mark_import_duplicates(&state.db, &account_id, &mut candidates).await?;
    apply_category_suggestions(&state.db, &account_id, &rules, &mut candidates).await?;
    let session_id = Uuid::new_v4().to_string();
    let file_name = path
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("arquivo")
        .to_string();
    state.sessions.lock().await.insert(
        session_id.clone(),
        ImportSession {
            account_id,
            file_name: file_name.clone(),
            candidates: candidates.clone(),
        },
    );
    Ok(ImportPreview {
        session_id,
        file_name,
        candidates,
    })
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
    mark_import_duplicates(&state.db, &account_id, &mut candidates).await?;
    apply_category_suggestions(&state.db, &account_id, &rules, &mut candidates).await?;
    let session_id = Uuid::new_v4().to_string();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("arquivo")
        .to_string();
    state.sessions.lock().await.insert(
        session_id.clone(),
        ImportSession {
            account_id,
            file_name: file_name.clone(),
            candidates: candidates.clone(),
        },
    );
    Ok(ImportPreview {
        session_id,
        file_name,
        candidates,
    })
}

#[tauri::command]
pub async fn update_import_candidate(
    session_id: String,
    source_row: usize,
    amount_in_cents: i64,
    included: bool,
    state: State<'_, AppState>,
) -> Result<ImportCandidate, AppError> {
    if amount_in_cents == 0 || amount_in_cents == i64::MIN {
        return Err(AppError::Validation(
            "O valor da transação não pode ser zero".into(),
        ));
    }
    let _commit_guard = state.import_commit.lock().await;
    let mut sessions = state.sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or(AppError::SessionExpired)?;
    let account_id = session.account_id.clone();
    let candidate = session
        .candidates
        .iter_mut()
        .find(|c| c.source_row == source_row)
        .ok_or_else(|| AppError::Validation("Lançamento não encontrado na sessão".into()))?;
    candidate.amount_in_cents = amount_in_cents;
    if let Some(id) = candidate.external_id.as_mut() {
        *id = id.trim().to_string();
        if id.is_empty() {
            candidate.external_id = None;
        }
    }
    let fp = fingerprint(&account_id, candidate);
    let duplicate = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM transactions WHERE account_id=? AND deleted_at IS NULL
         AND (CASE WHEN ? IS NOT NULL AND ? != '' THEN external_id=? ELSE fingerprint=? END)",
    )
    .bind(&account_id)
    .bind(candidate.external_id.as_deref())
    .bind(candidate.external_id.as_deref())
    .bind(candidate.external_id.as_deref())
    .bind(fp)
    .fetch_one(&state.db)
    .await?
        > 0;
    candidate.duplicate_status = if duplicate {
        crate::domain::import::DuplicateStatus::Exact
    } else {
        crate::domain::import::DuplicateStatus::New
    };
    candidate.included = included && !duplicate;
    let updated = candidate.clone();
    let _ = candidate;
    reclassify_import_session(&state.db, &account_id, &mut session.candidates).await?;
    Ok(session
        .candidates
        .iter()
        .find(|item| item.source_row == source_row)
        .cloned()
        .unwrap_or(updated))
}

#[tauri::command]
pub async fn set_import_candidate_category(
    session_id: String,
    source_row: usize,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _commit_guard = state.import_commit.lock().await;
    let category = if let Some(id) = &category_id {
        Some(
            sqlx::query_as::<_, (String, String)>(
                "SELECT name,kind FROM categories WHERE id=? AND deleted_at IS NULL",
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?,
        )
    } else {
        None
    };
    let mut sessions = state.sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or(AppError::SessionExpired)?;
    let candidate = session
        .candidates
        .iter_mut()
        .find(|c| c.source_row == source_row)
        .ok_or_else(|| AppError::Validation("Lançamento não encontrado na sessão".into()))?;
    if category
        .as_ref()
        .is_some_and(|(_, kind)| !explicit_bank_category_compatible(kind, candidate))
    {
        return Err(AppError::Validation(
            "A categoria não é compatível com este lançamento".into(),
        ));
    }
    candidate.suggested_category_id = category_id;
    candidate.suggested_category_name = category.map(|(name, _)| name);
    candidate.suggested_rule_id = None;
    candidate.suggested_rule_name = None;
    candidate.suggestion_source = None;
    Ok(())
}

#[tauri::command]
pub async fn set_import_candidates_category(
    session_id: String,
    source_rows: Vec<usize>,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<ImportPreview, AppError> {
    let _commit_guard = state.import_commit.lock().await;
    let rows: HashSet<usize> = source_rows.into_iter().collect();
    if rows.is_empty() {
        return Err(AppError::Validation(
            "Selecione ao menos um lançamento".into(),
        ));
    }
    let category = if let Some(id) = &category_id {
        Some(
            sqlx::query_as::<_, (String, String)>(
                "SELECT name,kind FROM categories WHERE id=? AND deleted_at IS NULL",
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?,
        )
    } else {
        None
    };
    let mut sessions = state.sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or(AppError::SessionExpired)?;
    if let Some((_, kind)) = &category {
        let incompatible = session.candidates.iter().any(|candidate| {
            rows.contains(&candidate.source_row)
                && !explicit_bank_category_compatible(kind, candidate)
        });
        if incompatible {
            return Err(AppError::Validation(
                "A categoria não é compatível com um ou mais lançamentos".into(),
            ));
        }
    }
    set_import_candidates_category_impl(
        session,
        &rows,
        category_id,
        category.map(|(name, _)| name),
    )?;
    Ok(ImportPreview {
        session_id,
        file_name: session.file_name.clone(),
        candidates: session.candidates.clone(),
    })
}

fn explicit_bank_category_compatible(category_kind: &str, candidate: &ImportCandidate) -> bool {
    category_kind == "transfer"
        || category_compatible(
            category_kind,
            candidate.amount_in_cents,
            SuggestionContext::Bank,
            is_refund_description(&candidate.normalized_description),
        )
}

fn set_import_candidates_category_impl(
    session: &mut ImportSession,
    rows: &HashSet<usize>,
    category_id: Option<String>,
    category_name: Option<String>,
) -> Result<(), AppError> {
    if session
        .candidates
        .iter()
        .filter(|candidate| rows.contains(&candidate.source_row))
        .count()
        != rows.len()
    {
        return Err(AppError::Validation(
            "Um ou mais lançamentos não foram encontrados na sessão".into(),
        ));
    }
    for candidate in session
        .candidates
        .iter_mut()
        .filter(|candidate| rows.contains(&candidate.source_row))
    {
        candidate.suggested_category_id = category_id.clone();
        candidate.suggested_category_name = category_name.clone();
        candidate.suggested_rule_id = None;
        candidate.suggested_rule_name = None;
        candidate.suggestion_source = None;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitImportResult {
    count: usize,
    batch_id: String,
}

#[tauri::command]
pub async fn commit_import(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<CommitImportResult, AppError> {
    let _commit_guard = state.import_commit.lock().await;
    let session = state
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or(AppError::SessionExpired)?;
    let result = commit_import_impl(session, &state.db).await?;
    state.sessions.lock().await.remove(&session_id);
    Ok(result)
}

async fn commit_import_impl(
    session: ImportSession,
    db: &SqlitePool,
) -> Result<CommitImportResult, AppError> {
    if !session
        .candidates
        .iter()
        .any(|candidate| candidate.included)
    {
        return Err(AppError::Validation(
            "Selecione ao menos um lançamento".into(),
        ));
    }
    let mut tx = db.begin().await?;
    let mut seen_external = HashSet::new();
    let mut seen_fingerprint = HashSet::new();
    for candidate in session
        .candidates
        .iter()
        .filter(|candidate| candidate.included)
    {
        let fp = fingerprint(&session.account_id, candidate);
        let conflict = if let Some(external) = candidate
            .external_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            !seen_external.insert(external.to_string()) || sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM transactions WHERE account_id=? AND external_id=? AND deleted_at IS NULL"
            ).bind(&session.account_id).bind(external).fetch_one(&mut *tx).await? > 0
        } else {
            !seen_fingerprint.insert(fp.clone()) || sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM transactions WHERE account_id=? AND fingerprint=? AND deleted_at IS NULL"
            ).bind(&session.account_id).bind(fp).fetch_one(&mut *tx).await? > 0
        };
        if conflict {
            return Err(AppError::Validation(
                "O arquivo contém lançamentos que já foram importados".into(),
            ));
        }
    }
    let batch_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO import_batches(id,file_name,created_at) VALUES(?,?,datetime('now'))")
        .bind(&batch_id)
        .bind(session.file_name)
        .execute(&mut *tx)
        .await?;
    let mut count = 0;
    for candidate in session.candidates {
        if !candidate.included
            || matches!(
                candidate.duplicate_status,
                crate::domain::import::DuplicateStatus::Exact
            )
        {
            continue;
        }
        let source = match candidate.suggestion_source {
            Some(SuggestionSource::Rule) => Some("rule"),
            Some(SuggestionSource::History) => Some("history"),
            None if candidate.suggested_category_id.is_some() => Some("manual"),
            None => None,
        };
        let merchant = (!candidate.needs_merchant_identification)
            .then(|| merchant_key(&candidate.normalized_description));
        let merchant_status = if candidate.needs_merchant_identification {
            "pending"
        } else {
            "identified"
        };
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,merchant_identification_status,
             amount_cents,external_id,fingerprint,status,import_batch_id,category_id,category_source,categorization_rule_id)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(Uuid::new_v4().to_string()).bind(&session.account_id).bind(&candidate.date)
            .bind(&candidate.description).bind(&candidate.normalized_description).bind(&merchant).bind(merchant_status)
            .bind(candidate.amount_in_cents)
            .bind(&candidate.external_id).bind(fingerprint(&session.account_id,&candidate)).bind("cleared")
            .bind(&batch_id).bind(&candidate.suggested_category_id).bind(source).bind(&candidate.suggested_rule_id)
            .execute(&mut *tx).await?;
        if let Some(rule_id) = candidate.suggested_rule_id {
            sqlx::query("UPDATE categorization_rules SET use_count=use_count+1 WHERE id=?")
                .bind(rule_id)
                .execute(&mut *tx)
                .await?;
        }
        count += 1;
    }
    tx.commit().await?;
    Ok(CommitImportResult { count, batch_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn onboarding_input() -> OnboardingInput {
        OnboardingInput {
            display_name: "Pessoa Teste".into(),
            monthly_target_in_cents: None,
            financial_goal: "organize".into(),
            onboarding_start_mode: "manual".into(),
        }
    }

    #[test]
    fn bulk_ids_are_deduplicated_and_bounded() {
        assert_eq!(
            normalize_transaction_ids(vec!["a".into(), "a".into(), "b".into()]).unwrap(),
            vec!["a", "b"]
        );
        assert!(normalize_transaction_ids(vec![]).is_err());
        assert!(normalize_transaction_ids((0..1001).map(|i| i.to_string()).collect()).is_err());
    }

    #[test]
    fn profile_validation_rejects_invalid_values() {
        assert!(validate_profile("A", None, None, None, None).is_err());
        assert!(validate_profile("Nome válido", Some(-1), None, None, None).is_err());
        assert!(validate_profile("Nome válido", None, Some(32), None, None).is_err());
        assert!(validate_profile("Nome válido", None, None, Some("unknown"), None).is_err());
        assert!(validate_profile("Nome válido", None, None, None, Some("unknown")).is_err());
        assert!(validate_profile(
            "Nome válido",
            None,
            Some(5),
            Some("fifth_business_day"),
            None
        )
        .is_err());
        assert!(validate_profile(
            "Nome válido",
            Some(500_000),
            None,
            Some("fifth_business_day"),
            Some("organize")
        )
        .is_ok());
    }

    #[tokio::test]
    async fn import_history_is_detected_from_completed_batches() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("bootstrap.db"))
            .await
            .unwrap();

        assert!(!has_import_batches(&db).await.unwrap());
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at) VALUES('batch-1','extrato.csv',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(has_import_batches(&db).await.unwrap());
    }

    #[tokio::test]
    async fn onboarding_persists_preferences_without_touching_financial_data() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("onboarding.db"))
            .await
            .unwrap();
        let input = OnboardingInput {
            display_name: "Pessoa Teste".into(),
            monthly_target_in_cents: Some(50_000),
            financial_goal: "emergency_fund".into(),
            onboarding_start_mode: "import".into(),
        };
        let result = complete_onboarding_impl(input, &db).await.unwrap();
        assert_eq!(result.profile.display_name, "Pessoa Teste");
        assert_eq!(result.profile.monthly_target_in_cents, Some(50_000));
        assert_eq!(
            result.profile.financial_goal.as_deref(),
            Some("emergency_fund")
        );
        assert_eq!(
            result.profile.onboarding_start_mode.as_deref(),
            Some("import")
        );
        let account_name: String = sqlx::query_scalar("SELECT name FROM accounts WHERE id=?")
            .bind(result.account_id)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(account_name, "Conta principal");
        let transaction_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(transaction_count, 0);
        let import_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_batches")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(import_count, 0);
    }

    #[tokio::test]
    async fn onboarding_reuses_canonical_savings_identity_after_disabling() {
        let directory = tempfile::tempdir().unwrap();
        let db =
            crate::infrastructure::database::connect(&directory.path().join("profile-target.db"))
                .await
                .unwrap();
        let mut enabled = onboarding_input();
        enabled.monthly_target_in_cents = Some(50_000);
        complete_onboarding_impl(enabled, &db).await.unwrap();
        let canonical_id: String =
            sqlx::query_scalar("SELECT id FROM financial_targets WHERE is_profile_target=1")
                .fetch_one(&db)
                .await
                .unwrap();
        let mut disabled = onboarding_input();
        disabled.monthly_target_in_cents = None;
        complete_onboarding_impl(disabled, &db).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT monthly_target_cents FROM user_profiles WHERE id='primary'",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT id FROM financial_targets WHERE is_profile_target=1",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            canonical_id
        );
        let mut reenabled = onboarding_input();
        reenabled.monthly_target_in_cents = Some(75_000);
        complete_onboarding_impl(reenabled, &db).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM financial_targets WHERE is_profile_target=1",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn profile_without_target_stays_null_when_settings_saves_another_field() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(
            &directory.path().join("profile-null-target.db"),
        )
        .await
        .unwrap();
        let onboarding = complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap();
        assert_eq!(onboarding.profile.monthly_target_in_cents, None);

        let saved = save_profile_impl(
            ProfileInput {
                display_name: "Pessoa renomeada".into(),
                monthly_income_in_cents: Some(400_000),
                monthly_target_in_cents: None,
                income_day: None,
                income_day_rule: None,
                financial_goal: Some("organize".into()),
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(saved.display_name, "Pessoa renomeada");
        assert_eq!(saved.monthly_target_in_cents, None);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT monthly_target_cents FROM user_profiles WHERE id='primary'",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn profile_edit_reuses_the_marked_active_savings_target() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(
            &directory.path().join("profile-active-target.db"),
        )
        .await
        .unwrap();
        complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO financial_targets(
               id,kind,amount_cents,enabled,is_profile_target
             ) VALUES('active-replacement','savings',20000,1,1)",
        )
        .execute(&db)
        .await
        .unwrap();

        let profile = save_profile_impl(
            ProfileInput {
                display_name: "Pessoa editada".into(),
                monthly_income_in_cents: None,
                monthly_target_in_cents: Some(60_000),
                income_day: None,
                income_day_rule: None,
                financial_goal: Some("save".into()),
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(profile.monthly_target_in_cents, Some(60_000));
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT id FROM financial_targets WHERE is_profile_target=1",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            "active-replacement"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM financial_targets
                 WHERE kind='savings' AND enabled=1 AND deleted_at IS NULL",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn manual_transaction_rejects_duplicate_fingerprint() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("manual.db"))
            .await
            .unwrap();
        let onboarding = onboarding_input();
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;
        let input = TransactionInput {
            id: None,
            account_id: account_id.clone(),
            date: "2026-06-10".into(),
            description: "Feira da semana".into(),
            amount_in_cents: -5000,
            category_id: None,
        };
        assert!(create_transaction_impl(input, &db).await.is_ok());
        let duplicate = TransactionInput {
            id: None,
            account_id,
            date: "2026-06-10".into(),
            description: "Feira da semana".into(),
            amount_in_cents: -5000,
            category_id: None,
        };
        assert!(create_transaction_impl(duplicate, &db).await.is_err());
    }

    #[tokio::test]
    async fn amount_sign_and_installment_mutations_are_revalidated_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("protected.db"))
            .await
            .unwrap();
        let account_id = complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap()
            .account_id;
        let transaction_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-10".into(),
                description: "Compra".into(),
                amount_in_cents: -5_000,
                category_id: Some("food".into()),
            },
            &db,
        )
        .await
        .unwrap();
        assert!(matches!(
            update_transaction_amount_impl(transaction_id.clone(), 5_000, &db).await,
            Err(AppError::Validation(_))
        ));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT amount_cents FROM transactions WHERE id=?")
                .bind(&transaction_id)
                .fetch_one(&db)
                .await
                .unwrap(),
            -5_000
        );

        sqlx::query(
            "INSERT INTO installment_plans(id,account_id,first_date,description,total_cents,installment_count)
             VALUES('plan',?,'2026-06-10','Compra',10000,2)",
        )
        .bind(&account_id)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_installments(plan_id,transaction_id,installment_number,installment_count)
             VALUES('plan',?,1,2)",
        )
        .bind(&transaction_id)
        .execute(&db)
        .await
        .unwrap();
        assert!(matches!(
            update_transaction_amount_impl(transaction_id.clone(), -6_000, &db).await,
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            delete_transactions_impl(vec![transaction_id.clone()], &db).await,
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            set_transaction_status_impl(transaction_id, "pending".into(), &db).await,
            Err(AppError::Validation(_))
        ));

        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,amount_cents,fingerprint,
               category_id,status
             ) VALUES(
               'protected-payment',?,'2026-06-11','Pagamento','PAGAMENTO',5000,
               'protected-payment-fp',NULL,'cleared'
             )",
        )
        .bind(&account_id)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at) VALUES('payment-batch','invoice.csv',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoices(
               id,account_id,due_date,purchases_cents,credits_cents,total_cents,status,import_batch_id
             ) VALUES('payment-invoice',?,'2026-06-15',0,0,0,'open','payment-batch')",
        )
        .bind(&account_id)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoice_items(
               invoice_id,transaction_id,source_row,raw_amount_cents,line_kind
             ) VALUES('payment-invoice','protected-payment',1,-5000,'payment')",
        )
        .execute(&db)
        .await
        .unwrap();

        let payment_id = "protected-payment".to_string();
        for result in [
            update_transaction_impl(
                TransactionInput {
                    id: Some(payment_id.clone()),
                    account_id: account_id.clone(),
                    date: "2026-06-11".into(),
                    description: "Pagamento editado".into(),
                    amount_in_cents: 5_000,
                    category_id: None,
                },
                &db,
            )
            .await,
            update_transaction_category_impl(payment_id.clone(), None, &db).await,
            update_transaction_amount_impl(payment_id.clone(), 6_000, &db).await,
            set_transaction_status_impl(payment_id.clone(), "pending".into(), &db).await,
            bulk_update_transaction_category_impl(vec![payment_id.clone()], None, &db)
                .await
                .map(|_| ()),
            delete_transactions_impl(vec![payment_id.clone()], &db)
                .await
                .map(|_| ()),
        ] {
            assert!(matches!(result, Err(AppError::Validation(_))));
        }
        let unchanged = sqlx::query(
            "SELECT description,amount_cents,category_id,status,deleted_at
             FROM transactions WHERE id='protected-payment'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(unchanged.get::<String, _>("description"), "Pagamento");
        assert_eq!(unchanged.get::<i64, _>("amount_cents"), 5_000);
        assert!(unchanged.get::<Option<String>, _>("category_id").is_none());
        assert_eq!(unchanged.get::<String, _>("status"), "cleared");
        assert!(unchanged.get::<Option<String>, _>("deleted_at").is_none());
    }

    #[tokio::test]
    async fn imported_transaction_alias_preserves_original_and_fingerprint() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("alias.db"))
            .await
            .unwrap();
        let account_id = complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap()
            .account_id;
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at) VALUES('batch-alias','extrato.ofx',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        let original_fingerprint = manual_fingerprint(
            &account_id,
            "2026-06-10",
            "COMPRA LOJA CENTRAL",
            "COMPRA LOJA CENTRAL",
            -5000,
        );
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,
             amount_cents,fingerprint,status,import_batch_id)
             VALUES('tx-alias',?,'2026-06-10','COMPRA LOJA CENTRAL','COMPRA LOJA CENTRAL',
             'LOJA CENTRAL',-5000,?,'cleared','batch-alias')",
        )
        .bind(&account_id)
        .bind(&original_fingerprint)
        .execute(&db)
        .await
        .unwrap();

        update_transaction_impl(
            TransactionInput {
                id: Some("tx-alias".into()),
                account_id,
                date: "2026-06-10".into(),
                description: "Loja do bairro".into(),
                amount_in_cents: -5000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        let row = sqlx::query(
            "SELECT description,normalized_description,display_description,merchant_key,fingerprint
             FROM transactions WHERE id='tx-alias'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(row.get::<String, _>("description"), "COMPRA LOJA CENTRAL");
        assert_eq!(
            row.get::<String, _>("normalized_description"),
            "COMPRA LOJA CENTRAL"
        );
        assert_eq!(
            row.get::<String, _>("display_description"),
            "Loja do bairro"
        );
        assert_eq!(row.get::<String, _>("merchant_key"), "LOJA CENTRAL");
        assert_eq!(row.get::<String, _>("fingerprint"), original_fingerprint);
        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        assert_eq!(page.items[0].description, "Loja do bairro");
        assert_eq!(
            page.items[0].original_description.as_deref(),
            Some("COMPRA LOJA CENTRAL")
        );
    }

    #[tokio::test]
    async fn updating_an_imported_transaction_does_not_freeze_a_global_merchant_alias() {
        let directory = tempfile::tempdir().unwrap();
        let db =
            crate::infrastructure::database::connect(&directory.path().join("alias-global.db"))
                .await
                .unwrap();
        let account_id = complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap()
            .account_id;
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at)
             VALUES('batch-global','extrato.ofx',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO merchant_aliases(id,merchant_key,display_name)
             VALUES('alias-global','FEIRA CENTRAL','Feira do bairro')",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,
             amount_cents,fingerprint,status,import_batch_id)
             VALUES('tx-global',?,'2026-06-10','PIX QRS FEIRA CENTRAL','PIX QRS FEIRA CENTRAL',
             'FEIRA CENTRAL',-5000,'fp-global','cleared','batch-global')",
        )
        .bind(&account_id)
        .execute(&db)
        .await
        .unwrap();

        update_transaction_impl(
            TransactionInput {
                id: Some("tx-global".into()),
                account_id,
                date: "2026-06-10".into(),
                description: "Feira do bairro".into(),
                amount_in_cents: -5000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        let stored_override: Option<String> =
            sqlx::query_scalar("SELECT display_description FROM transactions WHERE id='tx-global'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(
            stored_override, None,
            "saving another field must not copy the resolved global alias into the transaction"
        );

        sqlx::query(
            "UPDATE merchant_aliases SET display_name='Feira Central nova'
             WHERE id='alias-global'",
        )
        .execute(&db)
        .await
        .unwrap();
        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        assert_eq!(page.items[0].description, "Feira Central nova");
    }

    #[tokio::test]
    async fn transfer_creates_linked_legs_outside_income_and_expenses() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("transfer.db"))
            .await
            .unwrap();
        let onboarding = onboarding_input();
        let from_account = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;
        let to_account = "poupanca-teste".to_string();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'savings')")
            .bind(&to_account)
            .bind("Poupança")
            .execute(&db)
            .await
            .unwrap();

        // Same account on both sides is rejected.
        assert!(create_transfer_impl(
            TransferInput {
                from_account_id: from_account.clone(),
                to_account_id: from_account.clone(),
                date: "2026-06-10".into(),
                amount_in_cents: 10_000,
                description: None,
            },
            &db
        )
        .await
        .is_err());

        let ids = create_transfer_impl(
            TransferInput {
                from_account_id: from_account.clone(),
                to_account_id: to_account.clone(),
                date: "2026-06-10".into(),
                amount_in_cents: 10_000,
                description: None,
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(ids.len(), 2);

        // Both legs use the system transfer category and net out to zero.
        let (total, count): (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(SUM(amount_cents),0), COUNT(*) FROM transactions WHERE category_id='transfers' AND deleted_at IS NULL"
        ).fetch_one(&db).await.unwrap();
        assert_eq!(count, 2);
        assert_eq!(total, 0);

        // Neither leg counts as income or expense in the dashboard aggregation.
        let visible: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions t JOIN categories c ON c.id=t.category_id
             WHERE c.kind NOT IN ('transfer','investment') AND t.deleted_at IS NULL AND strftime('%Y-%m',t.date)='2026-06'"
        ).fetch_one(&db).await.unwrap();
        assert_eq!(visible, 0);

        // `create_transfer` links both legs via `transaction_links`, so they show up as
        // protected transfer legs just like credit-card payment legs do.
        let link_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transaction_links WHERE kind='transfer' AND debit_transaction_id=? AND credit_transaction_id=?"
        ).bind(&ids[0]).bind(&ids[1]).fetch_one(&db).await.unwrap();
        assert_eq!(link_count, 1);

        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        let debit = page.items.iter().find(|t| t.id == ids[0]).unwrap();
        let credit = page.items.iter().find(|t| t.id == ids[1]).unwrap();
        assert!(debit.is_transfer_leg);
        assert!(credit.is_transfer_leg);

        // Amount/date edits on a manually-created transfer leg are rejected, same as
        // credit-card payment legs.
        let bad_amount = update_transaction_impl(
            TransactionInput {
                id: Some(ids[0].clone()),
                account_id: from_account.clone(),
                date: "2026-06-10".into(),
                description: "Transferência para Poupança".into(),
                amount_in_cents: -20_000,
                category_id: None,
            },
            &db,
        )
        .await;
        assert!(bad_amount.is_err());

        // Repeating the exact same transfer is rejected as a duplicate.
        assert!(create_transfer_impl(
            TransferInput {
                from_account_id: from_account,
                to_account_id: to_account,
                date: "2026-06-10".into(),
                amount_in_cents: 10_000,
                description: None,
            },
            &db
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn transfer_update_unlink_delete_and_restore_keep_both_legs_consistent() {
        let directory = tempfile::tempdir().unwrap();
        let db =
            crate::infrastructure::database::connect(&directory.path().join("transfer-edit.db"))
                .await
                .unwrap();
        let checking = complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap()
            .account_id;
        let savings = "transfer-edit-savings".to_string();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'savings')")
            .bind(&savings)
            .bind("Reserva")
            .execute(&db)
            .await
            .unwrap();

        let ids = create_transfer_impl(
            TransferInput {
                from_account_id: checking.clone(),
                to_account_id: savings.clone(),
                date: "2026-06-10".into(),
                amount_in_cents: 10_000,
                description: None,
            },
            &db,
        )
        .await
        .unwrap();
        update_transfer_impl(
            &ids[1],
            TransferInput {
                from_account_id: savings.clone(),
                to_account_id: checking.clone(),
                date: "2026-06-12".into(),
                amount_in_cents: 12_345,
                description: Some("Volta para uso".into()),
            },
            &db,
        )
        .await
        .unwrap();
        let details = get_transfer_details_impl(&ids[0], &db).await.unwrap();
        assert_eq!(details.from_account_id, savings);
        assert_eq!(details.to_account_id, checking);
        assert_eq!(details.date, "2026-06-12");
        assert_eq!(details.amount_in_cents, 12_345);
        assert_eq!(details.description.as_deref(), Some("Volta para uso"));
        let legs: Vec<(String, i64, String)> = sqlx::query_as(
            "SELECT account_id,amount_cents,date FROM transactions
             WHERE id IN (?,?) ORDER BY amount_cents",
        )
        .bind(&ids[0])
        .bind(&ids[1])
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(
            legs,
            vec![
                ("transfer-edit-savings".into(), -12_345, "2026-06-12".into()),
                (details.to_account_id, 12_345, "2026-06-12".into())
            ]
        );

        assert_eq!(
            set_transfer_deleted_impl(&ids[0], true, &db).await.unwrap(),
            2
        );
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions WHERE id IN (?,?) AND deleted_at IS NULL",
        )
        .bind(&ids[0])
        .bind(&ids[1])
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(active, 0);
        assert_eq!(
            set_transfer_deleted_impl(&ids[1], false, &db)
                .await
                .unwrap(),
            2
        );

        unlink_transfer_impl(&ids[0], &db).await.unwrap();
        let restored: Vec<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT category_id,category_source,categorization_rule_id
             FROM transactions WHERE id IN (?,?) ORDER BY id",
        )
        .bind(&ids[0])
        .bind(&ids[1])
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(restored, vec![(None, None, None), (None, None, None)]);
        let links: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transaction_links
             WHERE debit_transaction_id IN (?,?) OR credit_transaction_id IN (?,?)",
        )
        .bind(&ids[0])
        .bind(&ids[1])
        .bind(&ids[0])
        .bind(&ids[1])
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(links, 0);
    }

    #[tokio::test]
    async fn unlink_transfer_restores_categories_from_both_imported_legs() {
        let directory = tempfile::tempdir().unwrap();
        let db =
            crate::infrastructure::database::connect(&directory.path().join("transfer-unlink.db"))
                .await
                .unwrap();
        let checking = complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap()
            .account_id;
        let savings = "transfer-unlink-savings".to_string();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'savings')")
            .bind(&savings)
            .bind("Reserva")
            .execute(&db)
            .await
            .unwrap();
        let expense_category: String =
            sqlx::query_scalar("SELECT id FROM categories WHERE kind='expense' LIMIT 1")
                .fetch_one(&db)
                .await
                .unwrap();
        let income_category: String =
            sqlx::query_scalar("SELECT id FROM categories WHERE kind='income' LIMIT 1")
                .fetch_one(&db)
                .await
                .unwrap();
        let debit_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: checking,
                date: "2026-06-10".into(),
                description: "Envio".into(),
                amount_in_cents: -10_000,
                category_id: Some(expense_category.clone()),
            },
            &db,
        )
        .await
        .unwrap();
        let credit_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: savings,
                date: "2026-06-10".into(),
                description: "Recebimento".into(),
                amount_in_cents: 10_000,
                category_id: Some(income_category.clone()),
            },
            &db,
        )
        .await
        .unwrap();
        link_transfer_pair_impl(debit_id.clone(), credit_id.clone(), &db)
            .await
            .unwrap();
        unlink_transfer_impl(&credit_id, &db).await.unwrap();
        let debit: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT category_id,category_source FROM transactions WHERE id=?")
                .bind(debit_id)
                .fetch_one(&db)
                .await
                .unwrap();
        let credit: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT category_id,category_source FROM transactions WHERE id=?")
                .bind(credit_id)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(debit, (Some(expense_category), Some("manual".into())));
        assert_eq!(credit, (Some(income_category), Some("manual".into())));
    }

    #[tokio::test]
    async fn detect_transfer_candidates_finds_opposite_pair_across_accounts() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("detect.db"))
            .await
            .unwrap();
        let onboarding = onboarding_input();
        let checking = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;
        let savings = "poupanca-teste".to_string();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'savings')")
            .bind(&savings)
            .bind("Poupança")
            .execute(&db)
            .await
            .unwrap();
        let card = "cartao-teste".to_string();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'credit_card')")
            .bind(&card)
            .bind("Cartão")
            .execute(&db)
            .await
            .unwrap();

        let debit_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: checking.clone(),
                date: "2026-06-10".into(),
                description: "Envio para poupança".into(),
                amount_in_cents: -15_000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        let credit_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: savings.clone(),
                date: "2026-06-12".into(),
                description: "Recebido da corrente".into(),
                amount_in_cents: 15_000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        // A same-amount pair involving a credit-card account must be ignored.
        create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: card.clone(),
                date: "2026-06-11".into(),
                description: "Pagamento no cartão".into(),
                amount_in_cents: 15_000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        let candidates = detect_transfer_candidates_impl(&db, None).await.unwrap();
        assert_eq!(candidates.len(), 1);
        let candidate = &candidates[0];
        assert_eq!(candidate.debit_transaction_id, debit_id);
        assert_eq!(candidate.credit_transaction_id, credit_id);
        assert_eq!(candidate.amount_in_cents, 15_000);

        // Linking the pair removes it from future candidate lists and already-linked
        // rows must be excluded.
        link_transfer_pair_impl(debit_id.clone(), credit_id.clone(), &db)
            .await
            .unwrap();
        let after_link = detect_transfer_candidates_impl(&db, None).await.unwrap();
        assert!(after_link.is_empty());

        let (debit_category, credit_category): (Option<String>, Option<String>) = (
            sqlx::query_scalar("SELECT category_id FROM transactions WHERE id=?")
                .bind(&debit_id)
                .fetch_one(&db)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT category_id FROM transactions WHERE id=?")
                .bind(&credit_id)
                .fetch_one(&db)
                .await
                .unwrap(),
        );
        assert_eq!(debit_category.as_deref(), Some(TRANSFER_CATEGORY_ID));
        assert_eq!(credit_category.as_deref(), Some(TRANSFER_CATEGORY_ID));

        // Both legs are now excluded from income/expense totals in the report aggregation.
        let visible: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions t JOIN categories c ON c.id=t.category_id
             WHERE t.id IN (?,?) AND c.kind NOT IN ('transfer','investment')",
        )
        .bind(&debit_id)
        .bind(&credit_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(visible, 0);

        // Trying to link an already-linked transaction again fails.
        assert!(link_transfer_pair_impl(debit_id, credit_id, &db)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn list_transactions_page_filters_paginates_and_counts() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("filter.db"))
            .await
            .unwrap();
        let onboarding = onboarding_input();
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;

        for i in 0..5 {
            create_transaction_impl(
                TransactionInput {
                    id: None,
                    account_id: account_id.clone(),
                    date: format!("2026-06-{:02}", 10 + i),
                    description: format!("Mercado Central {i}"),
                    amount_in_cents: -1000 - i,
                    category_id: None,
                },
                &db,
            )
            .await
            .unwrap();
        }
        create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-05-15".into(),
                description: "Outra loja".into(),
                amount_in_cents: -500,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        // Month filter + pagination.
        let page = query_transactions_page(
            &db,
            &TransactionFilter {
                month: Some("2026-06".into()),
                limit: Some(2),
                offset: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(page.total_count, 5);
        assert_eq!(page.items.len(), 2);

        let page2 = query_transactions_page(
            &db,
            &TransactionFilter {
                month: Some("2026-06".into()),
                limit: Some(2),
                offset: Some(4),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(page2.total_count, 5);
        assert_eq!(page2.items.len(), 1);

        // Search matches case/accent-folded description via normalized_description.
        let searched = query_transactions_page(
            &db,
            &TransactionFilter {
                search: Some("mercado".into()),
                limit: Some(50),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(searched.total_count, 5);
        assert!(searched
            .items
            .iter()
            .all(|t| t.description.starts_with("Mercado Central")));

        // Range filter excludes the May transaction.
        let ranged = query_transactions_page(
            &db,
            &TransactionFilter {
                start_month: Some("2026-06".into()),
                end_month: Some("2026-06".into()),
                limit: Some(50),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(ranged.total_count, 5);

        // Merchant key is an exact, server-side filter (not a text search).
        let exact_key = merchant_key(&normalize_description("Outra loja"));
        let merchant_page = query_transactions_page(
            &db,
            &TransactionFilter {
                merchant_key: Some(exact_key),
                limit: Some(50),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(merchant_page.total_count, 1);
        assert_eq!(merchant_page.items[0].description, "Outra loja");
    }

    #[tokio::test]
    async fn list_transactions_page_filters_status_movement_dates_and_amounts() {
        let directory = tempfile::tempdir().unwrap();
        let db =
            crate::infrastructure::database::connect(&directory.path().join("advanced-filter.db"))
                .await
                .unwrap();
        let onboarding = onboarding_input();
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;

        let pending_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-01".into(),
                description: "Padaria".into(),
                amount_in_cents: -2500,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        sqlx::query("UPDATE transactions SET status='pending' WHERE id=?")
            .bind(&pending_id)
            .execute(&db)
            .await
            .unwrap();
        let market_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-05".into(),
                description: "Mercado".into(),
                amount_in_cents: -9000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        let salary_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id,
                date: "2026-06-09".into(),
                description: "Salário".into(),
                amount_in_cents: 120000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        let pending = query_transactions_page(
            &db,
            &TransactionFilter {
                status: Some("pending".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(pending.total_count, 1);
        assert_eq!(pending.items[0].id, pending_id);

        let expense_range = query_transactions_page(
            &db,
            &TransactionFilter {
                movement_type: Some("expense".into()),
                min_abs_amount_in_cents: Some(3000),
                max_abs_amount_in_cents: Some(10000),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(expense_range.total_count, 1);
        assert_eq!(expense_range.items[0].id, market_id);

        let income = query_transactions_page(
            &db,
            &TransactionFilter {
                movement_type: Some("income".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(income.total_count, 1);
        assert_eq!(income.items[0].id, salary_id);

        let exact_dates = query_transactions_page(
            &db,
            &TransactionFilter {
                start_date: Some("2026-06-04".into()),
                end_date: Some("2026-06-06".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(exact_dates.total_count, 1);
        assert_eq!(exact_dates.items[0].id, market_id);
    }

    #[tokio::test]
    async fn list_transactions_marks_unlinked_invoice_payment_and_prioritizes_real_link() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(
            &directory.path().join("unlinked-invoice-payment.db"),
        )
        .await
        .unwrap();
        let account_id = complete_onboarding_impl(onboarding_input(), &db)
            .await
            .unwrap()
            .account_id;
        let card_account_id = "unlinked-payment-card";
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'credit_card')")
            .bind(card_account_id)
            .bind("Cartão")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at)
             VALUES('unlinked-payment-batch','fatura.csv',datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoices(
               id,account_id,due_date,purchases_cents,credits_cents,total_cents,import_batch_id
             ) VALUES('unlinked-payment-invoice',?,'2026-06-20',0,0,0,'unlinked-payment-batch')",
        )
        .bind(card_account_id)
        .execute(&db)
        .await
        .unwrap();
        let payment_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: card_account_id.into(),
                date: "2026-06-10".into(),
                description: "Pagamento anterior".into(),
                amount_in_cents: 5000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoice_items(
               invoice_id,transaction_id,source_row,raw_amount_cents,line_kind
             ) VALUES('unlinked-payment-invoice',?,1,-5000,'payment')",
        )
        .bind(&payment_id)
        .execute(&db)
        .await
        .unwrap();

        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        let payment = page
            .items
            .iter()
            .find(|item| item.id == payment_id)
            .unwrap();
        assert_eq!(payment.linked_kind.as_deref(), Some("credit_card_payment"));
        assert!(!payment.is_transfer_leg);

        let ordinary_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id,
                date: "2026-06-11".into(),
                description: "Lançamento comum".into(),
                amount_in_cents: -1000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        assert_eq!(
            page.items
                .iter()
                .find(|item| item.id == ordinary_id)
                .unwrap()
                .linked_kind,
            None
        );

        sqlx::query(
            "INSERT INTO transaction_links(id,kind,debit_transaction_id,credit_transaction_id)
             VALUES('real-link-priority','transfer',?,?)",
        )
        .bind(&ordinary_id)
        .bind(&payment_id)
        .execute(&db)
        .await
        .unwrap();
        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        let linked_payment = page
            .items
            .iter()
            .find(|item| item.id == payment_id)
            .unwrap();
        assert_eq!(linked_payment.linked_kind.as_deref(), Some("transfer"));
        assert!(linked_payment.is_transfer_leg);
    }

    #[tokio::test]
    async fn transfer_legs_are_flagged_and_protected_from_amount_date_edits() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("linked.db"))
            .await
            .unwrap();
        let onboarding = onboarding_input();
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;

        // A plain manual transaction is never a transfer leg.
        let plain_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-01".into(),
                description: "Padaria".into(),
                amount_in_cents: -300,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        // Two transactions linked with both legs recorded simulate a genuine two-leg transfer
        // (mirrors what `link_card_payment` inserts into `transaction_links`).
        let debit_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-02".into(),
                description: "Pagamento fatura".into(),
                amount_in_cents: -5000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        let credit_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-02".into(),
                description: "Recebimento fatura".into(),
                amount_in_cents: 5000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_links(id,kind,debit_transaction_id,credit_transaction_id)
             VALUES(?,'credit_card_payment',?,?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&debit_id)
        .bind(&credit_id)
        .execute(&db)
        .await
        .unwrap();

        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        let plain = page.items.iter().find(|t| t.id == plain_id).unwrap();
        let debit = page.items.iter().find(|t| t.id == debit_id).unwrap();
        let credit = page.items.iter().find(|t| t.id == credit_id).unwrap();
        assert!(!plain.is_transfer_leg);
        assert!(debit.is_transfer_leg);
        assert!(credit.is_transfer_leg);

        // Only the description is editable; linked transaction fields that affect the link are protected.
        let ok = update_transaction_impl(
            TransactionInput {
                id: Some(debit_id.clone()),
                account_id: account_id.clone(),
                date: "2026-06-02".into(),
                description: "Pagamento fatura cartão".into(),
                amount_in_cents: -5000,
                category_id: None,
            },
            &db,
        )
        .await;
        assert!(ok.is_ok());

        // ...but changing the amount or date of a transfer leg is rejected.
        let bad_amount = update_transaction_impl(
            TransactionInput {
                id: Some(debit_id.clone()),
                account_id: account_id.clone(),
                date: "2026-06-02".into(),
                description: "Pagamento fatura cartão".into(),
                amount_in_cents: -6000,
                category_id: None,
            },
            &db,
        )
        .await;
        assert!(bad_amount.is_err());

        let bad_date = update_transaction_impl(
            TransactionInput {
                id: Some(debit_id),
                account_id,
                date: "2026-06-03".into(),
                description: "Pagamento fatura cartão".into(),
                amount_in_cents: -5000,
                category_id: None,
            },
            &db,
        )
        .await;
        assert!(bad_date.is_err());
    }

    async fn linked_transaction_snapshot(
        db: &SqlitePool,
        transaction_id: &str,
    ) -> (i64, Option<String>, Option<String>, i64) {
        sqlx::query_as(
            "SELECT amount_cents,category_id,deleted_at,
                    EXISTS(SELECT 1 FROM transaction_links l
                           WHERE l.debit_transaction_id=transactions.id
                              OR l.credit_transaction_id=transactions.id)
             FROM transactions WHERE id=?",
        )
        .bind(transaction_id)
        .fetch_one(db)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn linked_transactions_block_generic_mutations_atomically() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let other_account = "linked-mutations-other";
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'savings')")
            .bind(other_account)
            .bind("Outra conta")
            .execute(&db)
            .await
            .unwrap();
        let common_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-10".into(),
                description: "Compra comum vinculada".into(),
                amount_in_cents: -1200,
                category_id: Some("food".into()),
            },
            &db,
        )
        .await
        .unwrap();
        let linked_ids = create_transfer_impl(
            TransferInput {
                from_account_id: account_id.clone(),
                to_account_id: other_account.into(),
                date: "2026-06-11".into(),
                amount_in_cents: 3000,
                description: Some("Transferência protegida".into()),
            },
            &db,
        )
        .await
        .unwrap();
        let before_linked = linked_transaction_snapshot(&db, &linked_ids[0]).await;
        let before_common = linked_transaction_snapshot(&db, &common_id).await;
        let before_links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transaction_links")
            .fetch_one(&db)
            .await
            .unwrap();

        let result = update_transaction_amount_impl(linked_ids[0].clone(), -9999, &db).await;
        assert!(matches!(result, Err(AppError::Validation(_))));
        let result =
            update_transaction_category_impl(linked_ids[0].clone(), Some("health".into()), &db)
                .await;
        assert!(matches!(result, Err(AppError::Validation(_))));
        let result = delete_transactions_impl(vec![linked_ids[0].clone()], &db).await;
        assert!(matches!(result, Err(AppError::Validation(_))));
        let result = restore_transactions_impl(vec![linked_ids[0].clone()], &db).await;
        assert!(matches!(result, Err(AppError::Validation(_))));
        let result = bulk_update_transaction_category_impl(
            vec![common_id.clone(), linked_ids[0].clone()],
            Some("health".into()),
            &db,
        )
        .await;
        assert!(matches!(result, Err(AppError::Validation(_))));

        assert_eq!(
            linked_transaction_snapshot(&db, &linked_ids[0]).await,
            before_linked
        );
        assert_eq!(
            linked_transaction_snapshot(&db, &common_id).await,
            before_common
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transaction_links")
                .fetch_one(&db)
                .await
                .unwrap(),
            before_links
        );
    }

    #[tokio::test]
    async fn invoice_only_link_is_protected_and_reported() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let card_account = "invoice-only-card";
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'credit_card')")
            .bind(card_account)
            .bind("Cartão")
            .execute(&db)
            .await
            .unwrap();
        let batch_id = "invoice-only-batch";
        sqlx::query(
            "INSERT INTO import_batches(id,file_name,created_at) VALUES(?,?,datetime('now'))",
        )
        .bind(batch_id)
        .bind("fatura.csv")
        .execute(&db)
        .await
        .unwrap();
        let invoice_id = "invoice-only-id";
        sqlx::query(
            "INSERT INTO credit_card_invoices(id,account_id,due_date,purchases_cents,credits_cents,total_cents,import_batch_id)
             VALUES(?,?,?,0,0,0,?)",
        )
        .bind(invoice_id)
        .bind(card_account)
        .bind("2026-06-30")
        .bind(batch_id)
        .execute(&db)
        .await
        .unwrap();
        let payment_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-12".into(),
                description: "Pagamento da fatura".into(),
                amount_in_cents: -4500,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transaction_links(id,kind,debit_transaction_id,invoice_id)
             VALUES(?,'credit_card_payment',?,?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&payment_id)
        .bind(invoice_id)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query("UPDATE transactions SET category_id='credit-card-payment',category_source='manual' WHERE id=?")
            .bind(&payment_id)
            .execute(&db)
            .await
            .unwrap();

        let page = query_transactions_page(&db, &TransactionFilter::default())
            .await
            .unwrap();
        assert!(
            page.items
                .iter()
                .find(|item| item.id == payment_id)
                .unwrap()
                .is_transfer_leg
        );
        let unchanged = linked_transaction_snapshot(&db, &payment_id).await;
        let result = update_transaction_impl(
            TransactionInput {
                id: Some(payment_id.clone()),
                account_id: account_id.clone(),
                date: "2026-06-12".into(),
                description: "Fatura paga no cartão".into(),
                amount_in_cents: -4500,
                category_id: Some("credit-card-payment".into()),
            },
            &db,
        )
        .await;
        assert!(result.is_ok(), "{result:?}");
        for input in [
            TransactionInput {
                id: Some(payment_id.clone()),
                account_id: card_account.into(),
                date: "2026-06-12".into(),
                description: "descrição".into(),
                amount_in_cents: -4500,
                category_id: Some("food".into()),
            },
            TransactionInput {
                id: Some(payment_id.clone()),
                account_id,
                date: "2026-06-13".into(),
                description: "descrição".into(),
                amount_in_cents: -4500,
                category_id: Some("credit-card-payment".into()),
            },
            TransactionInput {
                id: Some(payment_id.clone()),
                account_id: "invoice-only-card".into(),
                date: "2026-06-12".into(),
                description: "descrição".into(),
                amount_in_cents: -4000,
                category_id: Some("credit-card-payment".into()),
            },
        ] {
            assert!(matches!(
                update_transaction_impl(input, &db).await,
                Err(AppError::Validation(_))
            ));
        }
        let after = linked_transaction_snapshot(&db, &payment_id).await;
        assert_eq!(after.0, unchanged.0);
        assert_eq!(after.1, unchanged.1);
        assert_eq!(after.3, 1);
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT description FROM transactions WHERE id=?")
                .bind(payment_id)
                .fetch_one(&db)
                .await
                .unwrap(),
            "Fatura paga no cartão"
        );
    }

    #[tokio::test]
    async fn retroactive_rules_skip_linked_transactions() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let other_account = "retroactive-other";
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'savings')")
            .bind(other_account)
            .bind("Outra")
            .execute(&db)
            .await
            .unwrap();
        let common_id = create_transaction_impl(
            TransactionInput {
                id: None,
                account_id: account_id.clone(),
                date: "2026-06-14".into(),
                description: "REGRA comum".into(),
                amount_in_cents: -1000,
                category_id: Some("food".into()),
            },
            &db,
        )
        .await
        .unwrap();
        let linked_ids = create_transfer_impl(
            TransferInput {
                from_account_id: account_id,
                to_account_id: other_account.into(),
                date: "2026-06-15".into(),
                amount_in_cents: 2000,
                description: Some("REGRA protegida".into()),
            },
            &db,
        )
        .await
        .unwrap();
        let rule_id = "retroactive-rule";
        sqlx::query("INSERT INTO categorization_rules(id,name,priority,enabled,operator,pattern,movement_type,category_id) VALUES(?,'Regra',10,1,'contains','REGRA','expense','health')")
            .bind(rule_id).execute(&db).await.unwrap();
        let rules = load_rules(&db).await.unwrap();
        let impact = calculate_impact(&db, &rules[0], true).await.unwrap();
        assert_eq!(impact.count, 1);
        let applied = apply_rules_retroactive_impl(true, &db).await.unwrap();
        assert_eq!(applied, 1);
        let common: (String, String, String) = sqlx::query_as("SELECT category_id,category_source,categorization_rule_id FROM transactions WHERE id=?").bind(&common_id).fetch_one(&db).await.unwrap();
        assert_eq!(common, ("health".into(), "rule".into(), rule_id.into()));
        let linked: (String, String) =
            sqlx::query_as("SELECT category_id,category_source FROM transactions WHERE id=?")
                .bind(&linked_ids[0])
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(linked, (TRANSFER_CATEGORY_ID.into(), "manual".into()));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT use_count FROM categorization_rules WHERE id=?")
                .bind(rule_id)
                .fetch_one(&db)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn any_rule_does_not_apply_an_incompatible_category() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        create_transaction_impl(
            TransactionInput {
                id: None,
                account_id,
                date: "2026-06-14".into(),
                description: "BONUS usado como despesa".into(),
                amount_in_cents: -1000,
                category_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO categorization_rules(
               id,name,priority,enabled,operator,pattern,movement_type,category_id
             ) VALUES('any-income','Regra ampla',10,1,'contains','BONUS','any','income')",
        )
        .execute(&db)
        .await
        .unwrap();

        let rule = load_rules(&db).await.unwrap().remove(0);
        assert_eq!(calculate_impact(&db, &rule, true).await.unwrap().count, 0);
        assert_eq!(apply_rules_retroactive_impl(true, &db).await.unwrap(), 0);
    }

    async fn suggestion_test_setup() -> (tempfile::TempDir, SqlitePool, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("suggestion.db"))
            .await
            .unwrap();
        let onboarding = onboarding_input();
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;
        (directory, db, account_id)
    }

    async fn insert_history(
        db: &SqlitePool,
        account_id: &str,
        id: &str,
        description: &str,
        category_id: &str,
        amount_in_cents: i64,
    ) {
        let normalized = normalize_description(description);
        let key = merchant_key(&normalized);
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,fingerprint,category_id,category_source,status)
             VALUES(?,?,?,?,?,?,?,?,?,'manual','cleared')"
        ).bind(id).bind(account_id).bind("2026-05-01").bind(description).bind(&normalized).bind(&key)
            .bind(amount_in_cents).bind(format!("fp-{id}")).bind(category_id).execute(db).await.unwrap();
    }

    fn candidate(description: &str, amount_in_cents: i64) -> ImportCandidate {
        let normalized = normalize_description(description);
        ImportCandidate {
            source_row: 0,
            date: "2026-06-01".into(),
            description: description.into(),
            normalized_description: normalized,
            is_pix: is_pix_description(description),
            is_own_account_pix: is_own_account_pix_description(description),
            needs_merchant_identification: needs_pix_merchant_identification(description),
            amount_in_cents,
            external_id: None,
            suggested_category_id: None,
            suggested_category_name: None,
            suggested_rule_id: None,
            suggested_rule_name: None,
            suggestion_source: None,
            merchant_key: String::new(),
            category_suggestions: vec![],
            duplicate_status: crate::domain::import::DuplicateStatus::New,
            warnings: vec![],
            included: true,
        }
    }

    #[tokio::test]
    async fn generic_pix_commit_stays_financially_active_but_pending_identification() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let result = commit_import_impl(
            ImportSession {
                account_id,
                file_name: "extrato.ofx".into(),
                candidates: vec![candidate("Pix emitido outra IF", -3500)],
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(result.count, 1);
        let row: (Option<String>, String, i64) = sqlx::query_as(
            "SELECT merchant_key,merchant_identification_status,amount_cents
             FROM transactions WHERE import_batch_id=?",
        )
        .bind(result.batch_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(row, (None, "pending".into(), -3500));
    }

    #[test]
    fn explicit_bank_transfer_choice_is_allowed_without_becoming_a_suggestion() {
        let candidate = candidate("PIX.EMIT.OUT IF-MSM", -410_000);

        assert!(explicit_bank_category_compatible("transfer", &candidate));
        assert!(!category_compatible(
            "transfer",
            candidate.amount_in_cents,
            SuggestionContext::Bank,
            false,
        ));
    }

    #[test]
    fn grouped_bank_category_update_is_atomic_and_limited_to_requested_rows() {
        let mut first = candidate("Mercado Central", -1000);
        first.source_row = 1;
        let mut second = candidate("Mercado Central", -2000);
        second.source_row = 2;
        let mut third = candidate("Mercado Central", -3000);
        third.source_row = 3;
        let mut session = ImportSession {
            account_id: "account".into(),
            file_name: "extrato.csv".into(),
            candidates: vec![first, second, third],
        };
        set_import_candidates_category_impl(
            &mut session,
            &HashSet::from([1, 3]),
            Some("groceries".into()),
            Some("Supermercado".into()),
        )
        .unwrap();
        assert_eq!(
            session.candidates[0].suggested_category_id.as_deref(),
            Some("groceries")
        );
        assert_eq!(session.candidates[1].suggested_category_id, None);
        assert_eq!(
            session.candidates[2].suggested_category_id.as_deref(),
            Some("groceries")
        );

        let before = session
            .candidates
            .iter()
            .map(|candidate| candidate.suggested_category_id.clone())
            .collect::<Vec<_>>();
        assert!(set_import_candidates_category_impl(
            &mut session,
            &HashSet::from([1, 99]),
            Some("health".into()),
            Some("Saúde".into()),
        )
        .is_err());
        assert_eq!(
            before,
            session
                .candidates
                .iter()
                .map(|candidate| candidate.suggested_category_id.clone())
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn grouped_manual_choice_persists_and_teaches_future_history() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let mut first = candidate("SUPERMERCADO NOVO 01/02", -1000);
        first.source_row = 1;
        first.date = "2026-05-01".into();
        let mut second = candidate("SUPERMERCADO NOVO 02/02", -2000);
        second.source_row = 2;
        second.date = "2026-05-02".into();
        let mut third = candidate("SUPERMERCADO NOVO 03/03", -3000);
        third.source_row = 3;
        third.date = "2026-05-03".into();
        let mut session = ImportSession {
            account_id: account_id.clone(),
            file_name: "extrato.csv".into(),
            candidates: vec![first, second, third],
        };
        set_import_candidates_category_impl(
            &mut session,
            &HashSet::from([1, 2, 3]),
            Some("groceries".into()),
            Some("Supermercado".into()),
        )
        .unwrap();
        commit_import_impl(session, &db).await.unwrap();
        let manual_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transactions WHERE category_source='manual' AND category_id='groceries'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(manual_count, 3);

        let mut future = vec![candidate("SUPERMERCADO NOVO 04/04", -4000)];
        apply_category_suggestions(&db, &account_id, &[], &mut future)
            .await
            .unwrap();
        assert_eq!(
            future[0].suggested_category_id.as_deref(),
            Some("groceries")
        );
        assert_eq!(future[0].suggestion_source, Some(SuggestionSource::History));
    }

    #[tokio::test]
    async fn import_commit_conflict_rolls_back_and_does_not_consume_session_impl() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let mut conflicting = candidate("Conflito", -2000);
        conflicting.external_id = Some("external-conflict".into());
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,external_id,fingerprint,status)
             VALUES(?,?,?,?,?,?,?,?,?,'cleared')",
        )
        .bind("existing-import")
        .bind(&account_id)
        .bind("2026-06-01")
        .bind("Existente")
        .bind("EXISTENTE")
        .bind("existente")
        .bind(-2000_i64)
        .bind("external-conflict")
        .bind("existing-fingerprint")
        .execute(&db)
        .await
        .unwrap();
        let session = ImportSession {
            account_id,
            file_name: "conflito.csv".into(),
            candidates: vec![conflicting],
        };
        let batches_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_batches")
            .fetch_one(&db)
            .await
            .unwrap();
        let transactions_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(commit_import_impl(session, &db).await.is_err());
        assert_eq!(
            batches_before,
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM import_batches")
                .fetch_one(&db)
                .await
                .unwrap()
        );
        assert_eq!(
            transactions_before,
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions")
                .fetch_one(&db)
                .await
                .unwrap()
        );
        // The command wrapper removes the session only after this implementation succeeds.
    }

    #[tokio::test]
    async fn explicit_rule_always_wins_over_history_suggestion() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        for i in 0..3 {
            insert_history(
                &db,
                &account_id,
                &format!("h{i}"),
                "SUPERMERCADO BH LTDA",
                "food",
                -1000,
            )
            .await;
        }
        let rule = CategorizationRule {
            id: "r1".into(),
            name: "Saúde no mercado".into(),
            priority: 10,
            enabled: true,
            operator: RuleOperator::Contains,
            pattern: "SUPERMERCADO".into(),
            account_id: None,
            movement_type: MovementType::Expense,
            min_amount_in_cents: None,
            max_amount_in_cents: None,
            category_id: "health".into(),
            category_name: Some("Saúde".into()),
            use_count: 0,
            is_system: false,
        };
        let mut candidates = vec![candidate("SUPERMERCADO BH LTDA", -2000)];
        apply_category_suggestions(&db, &account_id, &[rule], &mut candidates)
            .await
            .unwrap();
        assert_eq!(
            candidates[0].suggested_category_id.as_deref(),
            Some("health")
        );
        assert!(matches!(
            candidates[0].suggestion_source,
            Some(crate::domain::import::SuggestionSource::Rule)
        ));
    }

    #[tokio::test]
    async fn history_suggestion_applies_when_no_rule_matches() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        for i in 0..3 {
            insert_history(
                &db,
                &account_id,
                &format!("h{i}"),
                "FARMACIA DROGASIL",
                "health",
                -3000,
            )
            .await;
        }
        let mut candidates = vec![candidate("FARMACIA DROGASIL", -4000)];
        apply_category_suggestions(&db, &account_id, &[], &mut candidates)
            .await
            .unwrap();
        assert_eq!(
            candidates[0].suggested_category_id.as_deref(),
            Some("health")
        );
        assert!(matches!(
            candidates[0].suggestion_source,
            Some(crate::domain::import::SuggestionSource::History)
        ));
    }

    #[tokio::test]
    async fn bank_pix_skips_history_preselection_but_keeps_shortlist() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        for i in 0..3 {
            insert_history(
                &db,
                &account_id,
                &format!("pix-history-{i}"),
                "PIX QRS FARMACIA SAO JOAO",
                "health",
                -3000,
            )
            .await;
        }
        let mut candidates = vec![candidate("PIX QRS FARMACIA SAO JOAO", -4000)];

        apply_category_suggestions(&db, &account_id, &[], &mut candidates)
            .await
            .unwrap();

        assert!(candidates[0].is_pix);
        assert_eq!(candidates[0].suggested_category_id, None);
        assert_eq!(candidates[0].suggestion_source, None);
        assert_eq!(
            candidates[0]
                .category_suggestions
                .first()
                .map(|suggestion| suggestion.category_id.as_str()),
            Some("health")
        );
    }

    #[tokio::test]
    async fn explicit_rule_still_wins_for_bank_pix() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let rule = CategorizationRule {
            id: "pix-rule".into(),
            name: "PIX da farmácia".into(),
            priority: 10,
            enabled: true,
            operator: RuleOperator::Contains,
            pattern: "FARMACIA".into(),
            account_id: None,
            movement_type: MovementType::Expense,
            min_amount_in_cents: None,
            max_amount_in_cents: None,
            category_id: "health".into(),
            category_name: Some("Saúde".into()),
            use_count: 0,
            is_system: false,
        };
        let mut candidates = vec![candidate("PIX QRS FARMACIA SAO JOAO", -4000)];

        apply_category_suggestions(&db, &account_id, &[rule], &mut candidates)
            .await
            .unwrap();

        assert_eq!(
            candidates[0].suggested_category_id.as_deref(),
            Some("health")
        );
        assert_eq!(
            candidates[0].suggestion_source,
            Some(SuggestionSource::Rule)
        );
    }

    #[tokio::test]
    async fn credit_card_pix_can_still_use_history_preselection() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        for i in 0..3 {
            insert_history(
                &db,
                &account_id,
                &format!("card-pix-history-{i}"),
                "PIX QRS FARMACIA SAO JOAO",
                "health",
                -3000,
            )
            .await;
        }
        let mut candidates = vec![candidate("PIX QRS FARMACIA SAO JOAO", -4000)];

        apply_category_suggestions_to(&db, &account_id, &[], candidates.iter_mut(), true)
            .await
            .unwrap();

        assert_eq!(
            candidates[0].suggested_category_id.as_deref(),
            Some("health")
        );
        assert_eq!(
            candidates[0].suggestion_source,
            Some(SuggestionSource::History)
        );
    }

    #[tokio::test]
    async fn unseen_description_gets_shortcuts_without_being_preselected() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        sqlx::query(
            "INSERT INTO categories(id,name,kind,sort_order) VALUES('gym','Academia','expense',999)",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO categories(id,name,kind,sort_order,deleted_at) VALUES('old-gym','Academia antiga','expense',1000,datetime('now'))",
        )
        .execute(&db)
        .await
        .unwrap();
        let mut candidates = vec![
            candidate("Farmácia São João", -4000),
            candidate("Academia Movimento", -9000),
        ];
        apply_category_suggestions(&db, &account_id, &[], &mut candidates)
            .await
            .unwrap();
        assert!(candidates
            .iter()
            .all(|candidate| candidate.suggested_category_id.is_none()));
        assert_eq!(candidates[0].merchant_key, "FARMACIA SAO JOAO");
        assert_eq!(candidates[0].category_suggestions[0].category_id, "health");
        assert_eq!(candidates[1].category_suggestions[0].category_id, "gym");
        assert!(candidates[1]
            .category_suggestions
            .iter()
            .all(|suggestion| suggestion.category_id != "old-gym"));
    }

    #[tokio::test]
    async fn preview_suggests_shopping_for_repeated_mercado_livre_descriptor() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let mut candidates = vec![candidate("MERCADO LIVRE*MERCADO LIVRE", -2500)];

        apply_category_suggestions(&db, &account_id, &[], &mut candidates)
            .await
            .unwrap();

        assert_eq!(candidates[0].merchant_key, "MERCADO LIVRE");
        assert_eq!(candidates[0].suggested_category_id, None);
        assert_eq!(
            candidates[0]
                .category_suggestions
                .first()
                .map(|suggestion| suggestion.category_id.as_str()),
            Some("shopping")
        );
        assert_eq!(
            candidates[0].category_suggestions[0].source,
            crate::domain::import::CategorySuggestionSource::Vocabulary
        );
    }

    #[tokio::test]
    async fn split_history_does_not_suggest() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        insert_history(&db, &account_id, "h1", "MERCADO MISTO", "food", -1000).await;
        insert_history(&db, &account_id, "h2", "MERCADO MISTO", "health", -1000).await;
        let mut candidates = vec![candidate("MERCADO MISTO", -1500)];
        apply_category_suggestions(&db, &account_id, &[], &mut candidates)
            .await
            .unwrap();
        assert_eq!(candidates[0].suggested_category_id, None);
        assert_eq!(candidates[0].suggestion_source, None);
    }

    #[tokio::test]
    async fn batched_suggestion_lookup_handles_500_candidates_functionally() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        for i in 0..200 {
            insert_history(
                &db,
                &account_id,
                &format!("h{i}"),
                &format!("FARMACIA HISTORICA {i}"),
                "health",
                -3000,
            )
            .await;
        }
        let mut candidates: Vec<_> = (0..500)
            .map(|i| candidate(&format!("FARMACIA NOVA {i}"), -4000))
            .collect();
        apply_category_suggestions(&db, &account_id, &[], &mut candidates)
            .await
            .unwrap();
        assert_eq!(candidates.len(), 500);
        assert!(candidates
            .iter()
            .all(|candidate| candidate.suggested_category_id.is_none()
                && candidate.category_suggestions[0].category_id == "health"));
    }

    #[tokio::test]
    async fn import_dedupe_keeps_first_intra_file_occurrence_and_scopes_account_and_delete() {
        let (_directory, db, account_id) = suggestion_test_setup().await;
        let other_account = "other-account";
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'checking')")
            .bind(other_account)
            .bind("Outra conta")
            .execute(&db)
            .await
            .unwrap();
        let mut candidates = vec![
            candidate("Compra repetida", -100),
            candidate("Compra repetida", -100),
        ];
        candidates[0].source_row = 1;
        candidates[1].source_row = 2;
        candidates[0].external_id = Some("external-1".into());
        candidates[1].external_id = Some("external-1".into());
        mark_import_duplicates(&db, &account_id, &mut candidates)
            .await
            .unwrap();
        assert!(candidates[0].included);
        assert!(matches!(
            candidates[0].duplicate_status,
            crate::domain::import::DuplicateStatus::New
        ));
        assert!(!candidates[1].included);
        assert!(matches!(
            candidates[1].duplicate_status,
            crate::domain::import::DuplicateStatus::Exact
        ));

        let mut other = vec![candidate("Compra repetida", -100)];
        mark_import_duplicates(&db, other_account, &mut other)
            .await
            .unwrap();
        assert!(other[0].included);

        let fp = fingerprint(&account_id, &candidates[0]);
        sqlx::query("INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,status,deleted_at) VALUES(?,?,?,?,?,?,?,'cleared',datetime('now'))")
            .bind("deleted-dedupe")
            .bind(&account_id)
            .bind("2026-06-01")
            .bind("Compra repetida")
            .bind("COMPRA REPETIDA")
            .bind(-100)
            .bind(fp)
            .execute(&db)
            .await
            .unwrap();
        let mut after_deleted = vec![candidate("Compra repetida", -100)];
        mark_import_duplicates(&db, &account_id, &mut after_deleted)
            .await
            .unwrap();
        assert!(after_deleted[0].included);
    }
}
