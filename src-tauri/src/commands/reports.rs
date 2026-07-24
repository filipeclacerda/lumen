use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

use crate::{
    application::state::AppState,
    domain::financial_metrics::{
        classify_financial_entry, FinancialAccountKind, FinancialCategoryKind,
        FinancialClassification, FinancialEntry, FinancialLinkedKind, FinancialMetrics,
    },
    error::AppError,
};

type KindCategoryMap = HashMap<Option<String>, (String, Option<String>, i64)>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportFilter {
    start_month: String,
    end_month: String,
    source: String,
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTrendFilter {
    category_id: Option<String>,
    end_month: String,
    source: String,
    account_id: Option<String>,
    months: i64,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    income_in_cents: i64,
    expenses_in_cents: i64,
    investments_in_cents: i64,
    savings_in_cents: i64,
    income_change_percent: Option<f64>,
    expense_change_percent: Option<f64>,
    savings_change_percent: Option<f64>,
    savings_rate_percent: Option<f64>,
    daily_average_in_cents: i64,
    projected_expenses_in_cents: i64,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReportPoint {
    month: String,
    income_in_cents: i64,
    expenses_in_cents: i64,
    investments_in_cents: i64,
    savings_in_cents: i64,
    savings_rate_percent: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryReport {
    category_id: Option<String>,
    category: String,
    color: Option<String>,
    amount_in_cents: i64,
    share_percent: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KindBreakdown {
    kind: String,
    total_in_cents: i64,
    categories: Vec<CategoryReport>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MerchantReport {
    merchant: String,
    merchant_key: String,
    original_name: String,
    alias: Option<String>,
    amount_in_cents: i64,
    transaction_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantPageFilter {
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantPage {
    items: Vec<MerchantReport>,
    total_count: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyReportPoint {
    date: String,
    amount_in_cents: i64,
    cumulative_in_cents: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceReport {
    source: String,
    amount_in_cents: i64,
    share_percent: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    target_id: String,
    kind: String,
    category_id: Option<String>,
    label: String,
    target_in_cents: i64,
    actual_in_cents: i64,
    remaining_in_cents: i64,
    progress_percent: f64,
    projected_in_cents: i64,
    projected_to_exceed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceReport {
    open_count: i64,
    paid_count: i64,
    open_total_in_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialReport {
    summary: ReportSummary,
    latest_month_summary: ReportSummary,
    previous_summary: ReportSummary,
    current_invested_in_cents: i64,
    monthly: Vec<MonthlyReportPoint>,
    categories: Vec<CategoryReport>,
    kind_breakdown: Vec<KindBreakdown>,
    merchants: Vec<MerchantReport>,
    daily: Vec<DailyReportPoint>,
    sources: Vec<SourceReport>,
    goals: Vec<GoalProgress>,
    invoices: InvoiceReport,
    uncategorized_count: i64,
    uncategorized_in_cents: i64,
    highest_spending_day: Option<DailyReportPoint>,
    monthly_average_in_cents: i64,
    card_share_percent: f64,
    alerts: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialTargetInput {
    id: Option<String>,
    kind: String,
    category_id: Option<String>,
    amount_in_cents: i64,
    enabled: bool,
    #[serde(default)]
    include_descendants: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetOverride {
    pub(crate) month: String,
    pub(crate) amount_in_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialTarget {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) category_id: Option<String>,
    pub(crate) category_name: Option<String>,
    pub(crate) amount_in_cents: i64,
    pub(crate) enabled: bool,
    pub(crate) include_descendants: bool,
    pub(crate) overrides: Vec<TargetOverride>,
}

#[derive(Clone)]
pub(crate) struct ReportRow {
    date: String,
    month: String,
    merchant_key: Option<String>,
    merchant_label: String,
    amount: i64,
    account_kind: String,
    pub(crate) category_id: Option<String>,
    category_name: Option<String>,
    category_color: Option<String>,
    category_kind: Option<String>,
    linked_kind: Option<String>,
}

/// Loads report rows for a single month with the `account_kind`/`category_kind` joins needed by
/// [`income_value`]/[`expense_value`]/[`investment_value`], scoped to `source`. Shared by the
/// financial report and the dashboard summary so both use identical income/expense/investment
/// classification.
pub(crate) async fn load_report_rows_for_month(
    db: &SqlitePool,
    month: &str,
    source: &str,
) -> Result<Vec<ReportRow>, AppError> {
    let rows = sqlx::query(
        "SELECT t.date, strftime('%Y-%m',t.date) month, t.merchant_key,
         COALESCE(ma.display_name, t.merchant_key, t.description) merchant_label, t.amount_cents,
         a.kind account_kind, t.category_id, c.name category_name, c.color category_color, c.kind category_kind,
         (SELECT l.kind FROM transaction_links l
          WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id LIMIT 1) linked_kind
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         LEFT JOIN merchant_aliases ma ON ma.merchant_key=t.merchant_key
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
         AND strftime('%Y-%m',t.date)=?
         AND (?='all' OR (?='bank' AND a.kind!='credit_card') OR (?='credit_card' AND a.kind='credit_card'))"
    ).bind(month).bind(source).bind(source).bind(source).fetch_all(db).await?;
    Ok(rows
        .into_iter()
        .map(|r| ReportRow {
            date: r.get("date"),
            month: r.get("month"),
            merchant_key: r.get("merchant_key"),
            merchant_label: r.get("merchant_label"),
            amount: r.get("amount_cents"),
            account_kind: r.get("account_kind"),
            category_id: r.get("category_id"),
            category_name: r.get("category_name"),
            category_color: r.get("category_color"),
            category_kind: r.get("category_kind"),
            linked_kind: r.get("linked_kind"),
        })
        .collect())
}

/// Aggregate dashboard figures for a single month, source="all" — reuses the same
/// income/expense/investment classification as [`generate_financial_report_impl`] so the
/// dashboard and the reports page never disagree (e.g. a credit-card refund is never counted as
/// income, and positive amounts in expense-kind categories reduce expenses rather than adding
/// income).
pub(crate) struct DashboardSummaryData {
    pub income_in_cents: i64,
    pub expenses_in_cents: i64,
    pub investments_in_cents: i64,
    pub balance_in_cents: i64,
    pub transaction_count: i64,
    pub by_category: Vec<(String, i64)>,
}

pub(crate) async fn dashboard_summary_data(
    db: &SqlitePool,
    month: &str,
) -> Result<DashboardSummaryData, AppError> {
    let rows = load_report_rows_for_month(db, month, "all").await?;
    let summary = summarize(&rows, month)?;
    let mut balance = 0i128;
    let mut category_map: HashMap<Option<String>, (String, i64)> = HashMap::new();
    for row in &rows {
        balance = balance
            .checked_add(i128::from(row.amount))
            .ok_or_else(financial_metrics_overflow)?;
        let expense = try_expense_value(row)?;
        if expense != 0 {
            let entry = category_map.entry(row.category_id.clone()).or_insert((
                row.category_name
                    .clone()
                    .unwrap_or_else(|| "Sem categoria".into()),
                0,
            ));
            entry.1 = entry
                .1
                .checked_add(expense)
                .ok_or_else(financial_metrics_overflow)?;
        }
    }
    let mut by_category: Vec<(String, i64)> = category_map
        .into_values()
        .filter(|(_, amount)| *amount > 0)
        .collect();
    by_category.sort_by_key(|item| std::cmp::Reverse(item.1));
    by_category.truncate(6);
    Ok(DashboardSummaryData {
        income_in_cents: summary.income_in_cents,
        expenses_in_cents: summary.expenses_in_cents,
        investments_in_cents: summary.investments_in_cents,
        balance_in_cents: metric_i64(balance)?,
        transaction_count: i64::try_from(rows.len()).map_err(|_| financial_metrics_overflow())?,
        by_category,
    })
}

pub(crate) fn parse_month(value: &str) -> Result<(i32, u32), AppError> {
    let date = NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Período mensal inválido".into()))?;
    Ok((date.year(), date.month()))
}

fn shift_month(value: &str, delta: i32) -> Result<String, AppError> {
    let (year, month) = parse_month(value)?;
    let index = year * 12 + month as i32 - 1 + delta;
    Ok(format!(
        "{:04}-{:02}",
        index.div_euclid(12),
        index.rem_euclid(12) + 1
    ))
}

fn month_range(start: &str, end: &str) -> Result<Vec<String>, AppError> {
    parse_month(start)?;
    parse_month(end)?;
    if start > end {
        return Err(AppError::Validation(
            "O início não pode ser posterior ao fim".into(),
        ));
    }
    let mut result = vec![];
    let mut current = start.to_string();
    while current.as_str() <= end {
        result.push(current.clone());
        if result.len() > 60 {
            return Err(AppError::Validation(
                "O período máximo é de 60 meses".into(),
            ));
        }
        current = shift_month(&current, 1)?;
    }
    Ok(result)
}

fn percent_change(current: i64, previous: i64) -> Option<f64> {
    if previous == 0 {
        None
    } else {
        Some(
            (i128::from(current) - i128::from(previous)) as f64 / i128::from(previous).abs() as f64
                * 100.0,
        )
    }
}

fn financial_metrics_overflow() -> AppError {
    AppError::Validation("Métricas financeiras excederam o limite numérico".into())
}

fn metric_i64(value: i128) -> Result<i64, AppError> {
    i64::try_from(value).map_err(|_| financial_metrics_overflow())
}

fn checked_add_i64(target: &mut i64, value: i64) -> Result<(), AppError> {
    *target = metric_i64(i128::from(*target) + i128::from(value))?;
    Ok(())
}

fn financial_entry(row: &ReportRow) -> FinancialEntry {
    FinancialEntry {
        amount_in_cents: row.amount,
        account_kind: FinancialAccountKind::from_database_value(&row.account_kind),
        category_kind: row
            .category_kind
            .as_deref()
            .and_then(|value| value.parse::<FinancialCategoryKind>().ok()),
        linked_kind: row
            .linked_kind
            .as_deref()
            .and_then(|value| value.parse::<FinancialLinkedKind>().ok()),
    }
}

fn try_expense_value(row: &ReportRow) -> Result<i64, AppError> {
    let entry = financial_entry(row);
    match classify_financial_entry(&entry) {
        FinancialClassification::Expense
        | FinancialClassification::ExpenseRefund
        | FinancialClassification::UncategorizedCreditCardExpense
        | FinancialClassification::UncategorizedCreditCardRefund => {
            metric_i64(-i128::from(row.amount))
        }
        _ => Ok(0),
    }
}

/// Compatibility helper for budget aggregation. Report generation uses the
/// fallible variant above so a narrowing failure becomes an `AppError`.
pub(crate) fn expense_value(row: &ReportRow) -> i64 {
    try_expense_value(row).unwrap_or(if row.amount < 0 { i64::MAX } else { i64::MIN })
}

pub(crate) fn income_value(row: &ReportRow) -> Result<i64, AppError> {
    let entry = financial_entry(row);
    match classify_financial_entry(&entry) {
        FinancialClassification::Income | FinancialClassification::IncomeReversal => Ok(row.amount),
        _ => Ok(0),
    }
}

pub(crate) fn investment_value(row: &ReportRow) -> Result<i64, AppError> {
    let entry = financial_entry(row);
    match classify_financial_entry(&entry) {
        FinancialClassification::InvestmentContribution
        | FinancialClassification::InvestmentRedemption => metric_i64(-i128::from(row.amount)),
        _ => Ok(0),
    }
}

fn summarize_rows<'a>(
    rows: impl IntoIterator<Item = &'a ReportRow>,
) -> Result<ReportSummary, AppError> {
    let entries: Vec<_> = rows.into_iter().map(financial_entry).collect();
    let metrics =
        FinancialMetrics::try_from_entries(&entries).map_err(|_| financial_metrics_overflow())?;
    let mut result = ReportSummary::default();
    result.income_in_cents = metric_i64(metrics.income_in_cents)?;
    result.expenses_in_cents = metric_i64(metrics.expenses_in_cents)?;
    result.investments_in_cents = metric_i64(metrics.investments_in_cents)?;
    result.savings_in_cents = metric_i64(metrics.savings_in_cents)?;
    result.savings_rate_percent = (result.income_in_cents > 0)
        .then_some(result.savings_in_cents as f64 / result.income_in_cents as f64 * 100.0);
    Ok(result)
}

fn summarize(rows: &[ReportRow], month: &str) -> Result<ReportSummary, AppError> {
    summarize_rows(rows.iter().filter(|row| row.month == month))
}

fn summarize_period(rows: &[&ReportRow]) -> Result<ReportSummary, AppError> {
    summarize_rows(rows.iter().copied())
}

pub(crate) fn days_in_month(month: &str) -> i64 {
    let next = shift_month(month, 1).unwrap();
    let date = NaiveDate::parse_from_str(&format!("{next}-01"), "%Y-%m-%d").unwrap();
    date.pred_opt().unwrap().day() as i64
}

pub(crate) fn effective_days(month: &str) -> i64 {
    let today = Local::now().date_naive();
    if month == today.format("%Y-%m").to_string() {
        today.day() as i64
    } else {
        days_in_month(month)
    }
}

pub(crate) async fn load_targets(db: &SqlitePool) -> Result<Vec<FinancialTarget>, AppError> {
    let rows = sqlx::query(
        "SELECT t.id,t.kind,t.category_id,c.name category_name,t.amount_cents,t.enabled,
                t.include_descendants
         FROM financial_targets t LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL ORDER BY t.kind,c.name",
    )
    .fetch_all(db)
    .await?;
    let mut targets = vec![];
    for row in rows {
        let id: String = row.get("id");
        let overrides=sqlx::query("SELECT month,amount_cents FROM financial_target_overrides WHERE target_id=? ORDER BY month")
            .bind(&id).fetch_all(db).await?.into_iter().map(|o|TargetOverride{
                month:o.get("month"),amount_in_cents:o.get("amount_cents")
            }).collect();
        targets.push(FinancialTarget {
            id,
            kind: row.get("kind"),
            category_id: row.get("category_id"),
            category_name: row.get("category_name"),
            amount_in_cents: row.get("amount_cents"),
            enabled: row.get::<i64, _>("enabled") != 0,
            include_descendants: row.get::<i64, _>("include_descendants") != 0,
            overrides,
        });
    }
    Ok(targets)
}

pub(crate) async fn load_category_children(
    db: &SqlitePool,
) -> Result<HashMap<String, Vec<String>>, AppError> {
    let rows = sqlx::query("SELECT id,parent_id FROM categories WHERE deleted_at IS NULL")
        .fetch_all(db)
        .await?;
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let id: String = row.get("id");
        if let Some(parent_id) = row.get::<Option<String>, _>("parent_id") {
            children.entry(parent_id).or_default().push(id);
        }
    }
    Ok(children)
}

pub(crate) fn category_scope_ids(
    category_id: &str,
    include_descendants: bool,
    children: &HashMap<String, Vec<String>>,
) -> HashSet<String> {
    let mut scope = HashSet::from([category_id.to_string()]);
    if !include_descendants {
        return scope;
    }
    let mut pending = vec![category_id.to_string()];
    while let Some(parent_id) = pending.pop() {
        if let Some(child_ids) = children.get(&parent_id) {
            for child_id in child_ids {
                if scope.insert(child_id.clone()) {
                    pending.push(child_id.clone());
                }
            }
        }
    }
    scope
}

#[tauri::command]
pub async fn list_financial_targets(
    state: State<'_, AppState>,
) -> Result<Vec<FinancialTarget>, AppError> {
    load_targets(&state.db).await
}

#[tauri::command]
pub async fn save_financial_target(
    input: FinancialTargetInput,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    save_financial_target_impl(input, &state.db).await
}

async fn save_financial_target_impl(
    input: FinancialTargetInput,
    db: &SqlitePool,
) -> Result<String, AppError> {
    if input.amount_in_cents <= 0 || !["savings", "category"].contains(&input.kind.as_str()) {
        return Err(AppError::Validation(
            "Tipo e valor positivo são obrigatórios".into(),
        ));
    }
    if input.kind == "category" {
        let id = input
            .category_id
            .as_ref()
            .ok_or_else(|| AppError::Validation("Escolha uma categoria".into()))?;
        let kind = sqlx::query_scalar::<_, String>(
            "SELECT kind FROM categories WHERE id=? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?;
        if kind != "expense" {
            return Err(AppError::Validation(
                "Metas de categoria exigem uma categoria de despesa".into(),
            ));
        }
    } else if input.category_id.is_some() {
        return Err(AppError::Validation(
            "Meta de economia não aceita categoria".into(),
        ));
    }
    if input.kind != "category" && input.include_descendants {
        return Err(AppError::Validation(
            "A opção de incluir subcategorias só vale para limites por categoria".into(),
        ));
    }
    if input.kind == "category" && input.id.is_some() {
        let marked: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM financial_targets WHERE id=? AND is_profile_target=1",
        )
        .bind(input.id.as_deref())
        .fetch_one(db)
        .await?;
        if marked > 0 {
            return Err(AppError::Validation(
                "A meta canônica do perfil não pode virar meta de categoria".into(),
            ));
        }
    }
    if input.kind == "savings" {
        if let Some(requested_id) = input.id.as_deref() {
            let existing_marker = sqlx::query_scalar::<_, i64>(
                "SELECT is_profile_target FROM financial_targets WHERE id=?",
            )
            .bind(requested_id)
            .fetch_optional(db)
            .await?;
            if existing_marker == Some(0) {
                return Err(AppError::Validation(
                    "O identificador informado pertence a outra meta".into(),
                ));
            }
        }
    }
    let mut tx = db.begin().await?;
    let id = if input.kind == "savings" {
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM financial_targets WHERE is_profile_target=1 LIMIT 1",
        )
        .fetch_optional(&mut *tx)
        .await?
        .or(input.id)
        .unwrap_or_else(|| "profile-monthly-savings".into())
    } else {
        input.id.unwrap_or_else(|| Uuid::new_v4().to_string())
    };
    sqlx::query(
        "INSERT INTO financial_targets(
           id,kind,category_id,amount_cents,enabled,include_descendants,is_profile_target
         ) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,category_id=excluded.category_id,
         amount_cents=excluded.amount_cents,enabled=excluded.enabled,deleted_at=NULL,
         include_descendants=excluded.include_descendants,
         is_profile_target=MAX(financial_targets.is_profile_target,excluded.is_profile_target),
         updated_at=datetime('now')",
    )
    .bind(&id)
    .bind(&input.kind)
    .bind(&input.category_id)
    .bind(input.amount_in_cents)
    .bind(input.enabled as i64)
    .bind(input.include_descendants as i64)
    .bind((input.kind == "savings") as i64)
    .execute(&mut *tx)
    .await?;
    if input.kind == "savings" {
        sqlx::query("UPDATE user_profiles SET monthly_target_cents=?,updated_at=datetime('now') WHERE id='primary'")
            .bind(if input.enabled { input.amount_in_cents } else { 0 })
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(id)
}

#[tauri::command]
pub async fn save_financial_target_override(
    target_id: String,
    month: String,
    amount_in_cents: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    parse_month(&month)?;
    if amount_in_cents <= 0 {
        return Err(AppError::Validation(
            "A meta mensal deve ser positiva".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO financial_target_overrides(id,target_id,month,amount_cents) VALUES(?,?,?,?)
         ON CONFLICT(target_id,month) DO UPDATE SET amount_cents=excluded.amount_cents,updated_at=datetime('now')"
    ).bind(Uuid::new_v4().to_string()).bind(target_id).bind(month).bind(amount_in_cents)
        .execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_financial_target(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    delete_financial_target_impl(id, &state.db).await
}

async fn delete_financial_target_impl(id: String, db: &SqlitePool) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    let is_profile_target: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(is_profile_target),0) FROM financial_targets WHERE id=?",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE financial_targets SET deleted_at=datetime('now'),enabled=0 WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if is_profile_target != 0 {
        sqlx::query("UPDATE user_profiles SET monthly_target_cents=0,updated_at=datetime('now') WHERE id='primary'")
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn generate_financial_report(
    filter: ReportFilter,
    state: State<'_, AppState>,
) -> Result<FinancialReport, AppError> {
    generate_financial_report_impl(filter, &state.db).await
}

#[tauri::command]
pub async fn list_merchants_page(
    filter: MerchantPageFilter,
    state: State<'_, AppState>,
) -> Result<MerchantPage, AppError> {
    list_merchants_page_impl(filter, &state.db).await
}

async fn list_merchants_page_impl(
    filter: MerchantPageFilter,
    db: &SqlitePool,
) -> Result<MerchantPage, AppError> {
    let sort = filter.sort.as_deref().unwrap_or("transaction_count");
    if !["transaction_count", "amount", "name"].contains(&sort) {
        return Err(AppError::Validation(
            "Ordenação de estabelecimentos inválida".into(),
        ));
    }
    let rows = sqlx::query(
        "SELECT t.date, strftime('%Y-%m',t.date) month, t.merchant_key,
         COALESCE(t.merchant_key, t.description) original_name, ma.display_name merchant_alias,
         COALESCE(ma.display_name, t.merchant_key, t.description) merchant_label, t.amount_cents,
         a.kind account_kind, t.category_id, c.name category_name, c.color category_color, c.kind category_kind,
         (SELECT l.kind FROM transaction_links l
          WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id LIMIT 1) linked_kind
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         LEFT JOIN merchant_aliases ma ON ma.merchant_key=t.merchant_key
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
         AND NOT EXISTS (
             SELECT 1 FROM transaction_links l
             WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id
         )",
    )
    .fetch_all(db)
    .await?;

    let mut merchant_map: HashMap<String, (String, Option<String>, i64, i64)> = HashMap::new();
    for row in rows {
        let report_row = ReportRow {
            date: row.get("date"),
            month: row.get("month"),
            merchant_key: row.get("merchant_key"),
            merchant_label: row.get("merchant_label"),
            amount: row.get("amount_cents"),
            account_kind: row.get("account_kind"),
            category_id: row.get("category_id"),
            category_name: row.get("category_name"),
            category_color: row.get("category_color"),
            category_kind: row.get("category_kind"),
            linked_kind: row.get("linked_kind"),
        };
        let expense = try_expense_value(&report_row)?;
        if expense <= 0 {
            continue;
        }
        let key = report_row
            .merchant_key
            .clone()
            .unwrap_or_else(|| report_row.merchant_label.clone());
        let original_name: String = row.get("original_name");
        let alias: Option<String> = row.get("merchant_alias");
        let merchant = merchant_map
            .entry(key)
            .or_insert((original_name, alias, 0, 0));
        merchant.2 += expense;
        merchant.3 += 1;
    }

    let mut merchants: Vec<MerchantReport> = merchant_map
        .into_iter()
        .map(
            |(merchant_key, (original_name, alias, amount_in_cents, transaction_count))| {
                MerchantReport {
                    merchant: alias.clone().unwrap_or_else(|| original_name.clone()),
                    merchant_key,
                    original_name,
                    alias,
                    amount_in_cents,
                    transaction_count,
                }
            },
        )
        .collect();
    let search = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(search) = search {
        let search = search.to_lowercase();
        merchants.retain(|item| {
            item.original_name.to_lowercase().contains(&search)
                || item
                    .alias
                    .as_deref()
                    .is_some_and(|alias| alias.to_lowercase().contains(&search))
        });
    }
    merchants.sort_by(|left, right| {
        let primary = match sort {
            "amount" => right.amount_in_cents.cmp(&left.amount_in_cents),
            "name" => left
                .merchant
                .to_lowercase()
                .cmp(&right.merchant.to_lowercase()),
            _ => right.transaction_count.cmp(&left.transaction_count),
        };
        primary.then_with(|| {
            left.merchant
                .to_lowercase()
                .cmp(&right.merchant.to_lowercase())
        })
    });
    let total_count = merchants.len() as i64;
    let limit = filter.limit.unwrap_or(10).clamp(1, 1000) as usize;
    let offset = filter.offset.unwrap_or(0).max(0) as usize;
    let items = merchants.into_iter().skip(offset).take(limit).collect();
    Ok(MerchantPage { items, total_count })
}

async fn generate_financial_report_impl(
    filter: ReportFilter,
    db: &SqlitePool,
) -> Result<FinancialReport, AppError> {
    let months = month_range(&filter.start_month, &filter.end_month)?;
    if !["all", "bank", "credit_card"].contains(&filter.source.as_str()) {
        return Err(AppError::Validation("Origem de relatório inválida".into()));
    }
    if let Some(account_id) = &filter.account_id {
        let exists: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM accounts WHERE id=? AND deleted_at IS NULL")
                .bind(account_id)
                .fetch_one(db)
                .await?;
        if exists == 0 {
            return Err(AppError::Validation("Conta não encontrada".into()));
        }
    }
    let previous_month = shift_month(&filter.end_month, -1)?;
    let query_start = if previous_month < filter.start_month {
        previous_month.clone()
    } else {
        filter.start_month.clone()
    };
    let rows=sqlx::query(
        "SELECT t.date, strftime('%Y-%m',t.date) month, t.merchant_key,
         COALESCE(ma.display_name, t.merchant_key, t.description) merchant_label, t.amount_cents,
         a.kind account_kind, t.category_id, c.name category_name, c.color category_color, c.kind category_kind,
         (SELECT l.kind FROM transaction_links l
          WHERE l.debit_transaction_id=t.id OR l.credit_transaction_id=t.id LIMIT 1) linked_kind
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         LEFT JOIN merchant_aliases ma ON ma.merchant_key=t.merchant_key
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
         AND strftime('%Y-%m',t.date)>=? AND strftime('%Y-%m',t.date)<=?
         AND (?='all' OR (?='bank' AND a.kind!='credit_card') OR (?='credit_card' AND a.kind='credit_card'))
         AND (? IS NULL OR t.account_id=?)"
    ).bind(&query_start).bind(&filter.end_month).bind(&filter.source).bind(&filter.source)
        .bind(&filter.source).bind(&filter.account_id).bind(&filter.account_id)
        .fetch_all(db).await?;
    let report_rows: Vec<ReportRow> = rows
        .into_iter()
        .map(|r| ReportRow {
            date: r.get("date"),
            month: r.get("month"),
            merchant_key: r.get("merchant_key"),
            merchant_label: r.get("merchant_label"),
            amount: r.get("amount_cents"),
            account_kind: r.get("account_kind"),
            category_id: r.get("category_id"),
            category_name: r.get("category_name"),
            category_color: r.get("category_color"),
            category_kind: r.get("category_kind"),
            linked_kind: r.get("linked_kind"),
        })
        .collect();

    let mut monthly = vec![];
    for month in &months {
        let summary = summarize(&report_rows, month)?;
        monthly.push(MonthlyReportPoint {
            month: month.clone(),
            income_in_cents: summary.income_in_cents,
            expenses_in_cents: summary.expenses_in_cents,
            investments_in_cents: summary.investments_in_cents,
            savings_in_cents: summary.savings_in_cents,
            savings_rate_percent: summary.savings_rate_percent,
        });
    }
    let period_rows: Vec<_> = report_rows
        .iter()
        .filter(|r| r.month >= filter.start_month && r.month <= filter.end_month)
        .collect();
    let mut summary = summarize_period(&period_rows)?;
    let mut latest_month_summary = summarize(&report_rows, &filter.end_month)?;
    let previous_summary = summarize(&report_rows, &previous_month)?;
    latest_month_summary.income_change_percent = percent_change(
        latest_month_summary.income_in_cents,
        previous_summary.income_in_cents,
    );
    latest_month_summary.expense_change_percent = percent_change(
        latest_month_summary.expenses_in_cents,
        previous_summary.expenses_in_cents,
    );
    latest_month_summary.savings_change_percent = percent_change(
        latest_month_summary.savings_in_cents,
        previous_summary.savings_in_cents,
    );
    let elapsed = effective_days(&filter.end_month).max(1);
    latest_month_summary.daily_average_in_cents = latest_month_summary.expenses_in_cents / elapsed;
    latest_month_summary.projected_expenses_in_cents = metric_i64(
        (i128::from(latest_month_summary.expenses_in_cents)
            * i128::from(days_in_month(&filter.end_month)))
            / i128::from(elapsed),
    )?;
    let period_days: i64 = months.iter().map(|m| effective_days(m)).sum();
    summary.daily_average_in_cents = if period_days == 0 {
        0
    } else {
        summary.expenses_in_cents / period_days
    };
    summary.projected_expenses_in_cents = latest_month_summary.projected_expenses_in_cents;

    let current_rows: Vec<_> = report_rows
        .iter()
        .filter(|r| r.month == filter.end_month)
        .collect();
    let mut category_map: HashMap<Option<String>, (String, Option<String>, i64)> = HashMap::new();
    let mut merchant_map: HashMap<String, (String, Option<String>, i64, i64)> = HashMap::new();
    let mut daily_map: BTreeMap<String, i64> = BTreeMap::new();
    let mut period_daily_map: BTreeMap<String, i64> = BTreeMap::new();
    let mut bank = 0;
    let mut card = 0;
    let mut uncategorized_count: i64 = 0;
    let mut uncategorized = 0;
    for row in &period_rows {
        let expense = try_expense_value(row)?;
        if expense == 0 {
            continue;
        }
        checked_add_i64(
            period_daily_map.entry(row.date.clone()).or_default(),
            expense,
        )?;
        let category = category_map.entry(row.category_id.clone()).or_insert((
            row.category_name
                .clone()
                .unwrap_or_else(|| "Sem categoria".into()),
            row.category_color.clone(),
            0,
        ));
        checked_add_i64(&mut category.2, expense)?;
        let merchant_group_key = row
            .merchant_key
            .clone()
            .unwrap_or_else(|| row.merchant_label.clone());
        let merchant = merchant_map.entry(merchant_group_key).or_insert((
            row.merchant_label.clone(),
            row.merchant_key.clone(),
            0,
            0,
        ));
        checked_add_i64(&mut merchant.2, expense)?;
        merchant.3 = merchant
            .3
            .checked_add(1)
            .ok_or_else(financial_metrics_overflow)?;
        if row.account_kind == "credit_card" {
            checked_add_i64(&mut card, expense)?;
        } else {
            checked_add_i64(&mut bank, expense)?;
        }
        if row.category_id.is_none() {
            uncategorized_count = uncategorized_count
                .checked_add(1)
                .ok_or_else(financial_metrics_overflow)?;
            checked_add_i64(&mut uncategorized, expense)?;
        }
    }
    for row in current_rows {
        let expense = try_expense_value(row)?;
        if expense == 0 {
            continue;
        }
        checked_add_i64(daily_map.entry(row.date.clone()).or_default(), expense)?;
    }
    let category_total = category_map
        .values()
        .try_fold(0i128, |total, (_, _, amount)| {
            total
                .checked_add(i128::from((*amount).max(0)))
                .ok_or_else(financial_metrics_overflow)
        })?
        .max(1);
    let mut categories: Vec<_> = category_map
        .into_iter()
        .map(|(id, (name, color, amount))| CategoryReport {
            category_id: id,
            category: name,
            color,
            amount_in_cents: amount.max(0),
            share_percent: amount.max(0) as f64 / category_total as f64 * 100.0,
        })
        .collect();
    categories.sort_by_key(|x| -x.amount_in_cents);

    // Build per-kind breakdown (income, expense, investment) from the same unitary
    // classification as the summaries, so reversals offset their original category.
    let mut kind_map: HashMap<String, KindCategoryMap> = HashMap::new();
    for row in &period_rows {
        let entry_classification = classify_financial_entry(&financial_entry(row));
        let (kind, signed) = match entry_classification {
            FinancialClassification::Income | FinancialClassification::IncomeReversal => {
                ("income", income_value(row)?)
            }
            FinancialClassification::InvestmentContribution
            | FinancialClassification::InvestmentRedemption => {
                ("investment", investment_value(row)?)
            }
            FinancialClassification::Expense
            | FinancialClassification::ExpenseRefund
            | FinancialClassification::UncategorizedCreditCardExpense
            | FinancialClassification::UncategorizedCreditCardRefund => {
                ("expense", try_expense_value(row)?)
            }
            FinancialClassification::Transfer
            | FinancialClassification::CreditCardPayment
            | FinancialClassification::Ignored => continue,
        };
        if signed == 0 {
            continue;
        }
        let entry = kind_map.entry(kind.into()).or_default();
        let cat = entry.entry(row.category_id.clone()).or_insert((
            row.category_name
                .clone()
                .unwrap_or_else(|| "Sem categoria".into()),
            row.category_color.clone(),
            0,
        ));
        checked_add_i64(&mut cat.2, signed)?;
    }
    let mut kind_breakdown = Vec::with_capacity(kind_map.len());
    for (kind, inner) in kind_map {
        let kind_total = inner.values().try_fold(0i128, |total, item| {
            total
                .checked_add(i128::from(item.2.max(0)))
                .ok_or_else(financial_metrics_overflow)
        })?;
        let div = kind_total.max(1);
        let mut list: Vec<_> = inner
            .into_iter()
            .map(|(id, (name, color, amount))| CategoryReport {
                category_id: id,
                category: name,
                color,
                amount_in_cents: amount.max(0),
                share_percent: amount.max(0) as f64 / div as f64 * 100.0,
            })
            .collect();
        list.sort_by_key(|x| -x.amount_in_cents);
        kind_breakdown.push(KindBreakdown {
            kind,
            total_in_cents: metric_i64(kind_total)?,
            categories: list,
        });
    }
    kind_breakdown.sort_by_key(|k| match k.kind.as_str() {
        "income" => 0,
        "expense" => 1,
        "investment" => 2,
        _ => 3,
    });

    let mut merchants: Vec<_> = merchant_map
        .into_iter()
        .map(|(_, (label, key, amount, count))| MerchantReport {
            merchant: label.clone(),
            merchant_key: key.unwrap_or_else(|| label.clone()),
            original_name: label,
            alias: None,
            amount_in_cents: amount.max(0),
            transaction_count: count,
        })
        .collect();
    merchants.sort_by_key(|x| -x.amount_in_cents);
    merchants.truncate(8);
    let mut cumulative = 0;
    let mut daily = Vec::with_capacity(daily_map.len());
    for (date, amount) in daily_map {
        checked_add_i64(&mut cumulative, amount)?;
        daily.push(DailyReportPoint {
            date,
            amount_in_cents: amount,
            cumulative_in_cents: cumulative,
        });
    }
    let mut period_cumulative = 0;
    let mut period_daily = Vec::with_capacity(period_daily_map.len());
    for (date, amount) in period_daily_map {
        checked_add_i64(&mut period_cumulative, amount)?;
        period_daily.push(DailyReportPoint {
            date,
            amount_in_cents: amount,
            cumulative_in_cents: period_cumulative,
        });
    }
    let highest_spending_day = period_daily
        .into_iter()
        .max_by_key(|point| point.amount_in_cents);
    let source_total = (i128::from(bank.max(0)) + i128::from(card.max(0))).max(1);
    let sources = vec![
        SourceReport {
            source: "bank".into(),
            amount_in_cents: bank.max(0),
            share_percent: bank.max(0) as f64 / source_total as f64 * 100.0,
        },
        SourceReport {
            source: "credit_card".into(),
            amount_in_cents: card.max(0),
            share_percent: card.max(0) as f64 / source_total as f64 * 100.0,
        },
    ];

    // Goals are global product settings. Their progress must not change when
    // the report is narrowed to a source or an individual account.
    let global_current_rows = load_report_rows_for_month(db, &filter.end_month, "all").await?;
    let global_latest_month_summary = summarize(&global_current_rows, &filter.end_month)?;
    let mut global_current_category_map: HashMap<Option<String>, i64> = HashMap::new();
    for row in &global_current_rows {
        let expense = try_expense_value(row)?;
        if expense != 0 {
            checked_add_i64(
                global_current_category_map
                    .entry(row.category_id.clone())
                    .or_default(),
                expense,
            )?;
        }
    }
    let targets = load_targets(db).await?;
    let category_children = load_category_children(db).await?;
    let mut goals = vec![];
    for target in targets.into_iter().filter(|t| t.enabled) {
        let target_amount = target
            .overrides
            .iter()
            .find(|o| o.month == filter.end_month)
            .map(|o| o.amount_in_cents)
            .unwrap_or(target.amount_in_cents);
        let actual = if target.kind == "savings" {
            global_latest_month_summary.savings_in_cents
        } else {
            let category_id = target
                .category_id
                .as_deref()
                .ok_or_else(|| AppError::Validation("Meta de categoria sem categoria".into()))?;
            let scope =
                category_scope_ids(category_id, target.include_descendants, &category_children);
            scope
                .iter()
                .try_fold(0i128, |total, category_id| {
                    total
                        .checked_add(i128::from(
                            global_current_category_map
                                .get(&Some(category_id.clone()))
                                .copied()
                                .unwrap_or(0),
                        ))
                        .ok_or_else(financial_metrics_overflow)
                })
                .and_then(metric_i64)?
                .max(0)
        };
        let is_current_month =
            filter.end_month == Local::now().date_naive().format("%Y-%m").to_string();
        let projected = if target.kind == "savings" {
            if is_current_month {
                let days = days_in_month(&filter.end_month) as i128;
                let projected_income = (i128::from(global_latest_month_summary.income_in_cents)
                    * days)
                    / i128::from(elapsed);
                let projected_expenses =
                    (i128::from(global_latest_month_summary.expenses_in_cents) * days)
                        / i128::from(elapsed);
                metric_i64(projected_income - projected_expenses)?
            } else {
                // Past (or future) months: the month is fully elapsed, so the actual figure is final.
                actual
            }
        } else if is_current_month {
            // Pro-rate the current month's partial category spend to a full-month projection.
            metric_i64(
                (i128::from(actual) * i128::from(days_in_month(&filter.end_month)))
                    / i128::from(elapsed),
            )?
        } else {
            actual
        };
        goals.push(GoalProgress {
            target_id: target.id,
            kind: target.kind.clone(),
            category_id: target.category_id,
            label: target
                .category_name
                .unwrap_or_else(|| "Economia mensal".into()),
            target_in_cents: target_amount,
            actual_in_cents: actual,
            remaining_in_cents: metric_i64(i128::from(target_amount) - i128::from(actual))?,
            progress_percent: actual as f64 / target_amount as f64 * 100.0,
            projected_in_cents: projected,
            projected_to_exceed: if target.kind == "savings" {
                projected < target_amount
            } else {
                projected > target_amount
            },
        });
    }

    let invoice=sqlx::query(
        "SELECT COALESCE(SUM(CASE WHEN status='open' THEN 1 ELSE 0 END),0) open_count,
         COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) paid_count,
         COALESCE(SUM(CASE WHEN status='open' THEN total_cents ELSE 0 END),0) open_total
         FROM credit_card_invoices i JOIN accounts a ON a.id=i.account_id
         WHERE i.deleted_at IS NULL AND strftime('%Y-%m',i.due_date)>=? AND strftime('%Y-%m',i.due_date)<=?
         AND ?!='bank'
         AND (? IS NULL OR i.account_id=?)"
    ).bind(&filter.start_month).bind(&filter.end_month).bind(&filter.source)
        .bind(&filter.account_id).bind(&filter.account_id)
        .fetch_one(db).await?;
    let invoices = InvoiceReport {
        open_count: invoice.get("open_count"),
        paid_count: invoice.get("paid_count"),
        open_total_in_cents: invoice.get("open_total"),
    };
    let current_invested:i64=sqlx::query_scalar(
        "SELECT COALESCE(-SUM(t.amount_cents),0)
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND c.kind='investment'
         AND (?='all' OR (?='bank' AND a.kind!='credit_card') OR (?='credit_card' AND a.kind='credit_card'))
         AND (? IS NULL OR t.account_id=?)"
    ).bind(&filter.source).bind(&filter.source).bind(&filter.source)
        .bind(&filter.account_id).bind(&filter.account_id).fetch_one(db).await?;
    let monthly_average = if monthly.is_empty() {
        0
    } else {
        let total = monthly.iter().try_fold(0i128, |total, point| {
            total
                .checked_add(i128::from(point.expenses_in_cents))
                .ok_or_else(financial_metrics_overflow)
        })?;
        metric_i64(
            total / i128::try_from(monthly.len()).map_err(|_| financial_metrics_overflow())?,
        )?
    };
    let card_share = card.max(0) as f64 / source_total as f64 * 100.0;
    let mut alerts = vec![];
    if latest_month_summary.expenses_in_cents > previous_summary.expenses_in_cents
        && previous_summary.expenses_in_cents > 0
    {
        alerts.push(format!(
            "As despesas subiram {:.0}% em relação ao mês anterior.",
            latest_month_summary.expense_change_percent.unwrap_or(0.0)
        ));
    }
    if uncategorized_count > 0 {
        alerts.push(format!(
            "{uncategorized_count} transações ainda estão sem categoria."
        ));
    }
    for goal in &goals {
        if goal.projected_to_exceed {
            alerts.push(format!("A projeção de {} está fora da meta.", goal.label));
        }
    }
    Ok(FinancialReport {
        summary,
        latest_month_summary,
        previous_summary,
        current_invested_in_cents: current_invested.max(0),
        monthly,
        categories,
        kind_breakdown,
        merchants,
        daily,
        sources,
        goals,
        invoices,
        uncategorized_count,
        uncategorized_in_cents: uncategorized.max(0),
        highest_spending_day,
        monthly_average_in_cents: monthly_average,
        card_share_percent: card_share,
        alerts,
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTrendPoint {
    month: String,
    amount_in_cents: i64,
}

/// Monthly spend for a single category (or "sem categoria" when `category_id` is `None`)
/// using the same source/account/end-month context as the financial report.
#[tauri::command]
pub async fn category_trend(
    filter: CategoryTrendFilter,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryTrendPoint>, AppError> {
    category_trend_impl(filter, &state.db).await
}

async fn category_trend_impl(
    filter: CategoryTrendFilter,
    db: &SqlitePool,
) -> Result<Vec<CategoryTrendPoint>, AppError> {
    if !["all", "bank", "credit_card"].contains(&filter.source.as_str()) {
        return Err(AppError::Validation("Origem de relatório inválida".into()));
    }
    parse_month(&filter.end_month)?;
    if let Some(account_id) = &filter.account_id {
        let exists: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM accounts WHERE id=? AND deleted_at IS NULL")
                .bind(account_id)
                .fetch_one(db)
                .await?;
        if exists == 0 {
            return Err(AppError::Validation("Conta não encontrada".into()));
        }
    }
    let months = filter.months.clamp(1, 24);
    let start_month = shift_month(&filter.end_month, -(months as i32 - 1))?;
    let month_list = month_range(&start_month, &filter.end_month)?;
    let rows = sqlx::query(
        "SELECT strftime('%Y-%m',t.date) month,
         COALESCE(SUM(CASE
           WHEN c.kind='transfer' THEN 0
           WHEN c.kind='income' THEN t.amount_cents
           WHEN c.kind='investment' THEN -t.amount_cents
           WHEN c.kind='expense' THEN -t.amount_cents
           WHEN a.kind='credit_card' THEN -t.amount_cents
           WHEN t.amount_cents<0 THEN -t.amount_cents
           ELSE 0
         END),0) amount
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
         AND ((?1 IS NULL AND t.category_id IS NULL) OR t.category_id=?1)
         AND strftime('%Y-%m',t.date)>=?2 AND strftime('%Y-%m',t.date)<=?3
         AND (?4='all' OR (?4='bank' AND a.kind!='credit_card') OR (?4='credit_card' AND a.kind='credit_card'))
         AND (?5 IS NULL OR t.account_id=?5)
         GROUP BY month"
    ).bind(&filter.category_id).bind(&start_month).bind(&filter.end_month).bind(&filter.source)
        .bind(&filter.account_id).fetch_all(db).await?;
    let mut by_month: HashMap<String, i64> = rows
        .into_iter()
        .map(|r| (r.get("month"), r.get::<i64, _>("amount").max(0)))
        .collect();
    Ok(month_list
        .into_iter()
        .map(|month| CategoryTrendPoint {
            amount_in_cents: by_month.remove(&month).unwrap_or(0),
            month,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::merchant::merchant_key;

    #[test]
    fn month_helpers_cover_year_boundaries() {
        assert_eq!(shift_month("2026-01", -1).unwrap(), "2025-12");
        assert_eq!(month_range("2025-11", "2026-02").unwrap().len(), 4);
    }
    #[test]
    fn percent_change_handles_zero() {
        assert_eq!(percent_change(10, 0), None);
    }

    async fn setup() -> (tempfile::TempDir, SqlitePool, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("reports.db"))
            .await
            .unwrap();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('acc','Conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        (directory, db, "acc".into())
    }

    #[tokio::test]
    async fn savings_target_rejects_category_ids_and_preserves_canonical_identity_on_delete() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query(
            "INSERT INTO user_profiles(id,display_name,onboarding_completed_at,monthly_target_cents)
             VALUES('primary','Pessoa',datetime('now'),0)",
        )
        .execute(&db)
        .await
        .unwrap();
        let canonical = save_financial_target_impl(
            FinancialTargetInput {
                id: None,
                kind: "savings".into(),
                category_id: None,
                amount_in_cents: 30_000,
                enabled: true,
                include_descendants: false,
            },
            &db,
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO financial_targets(id,kind,category_id,amount_cents)
             VALUES('category-target','category','food',10000)",
        )
        .execute(&db)
        .await
        .unwrap();

        let invalid = save_financial_target_impl(
            FinancialTargetInput {
                id: Some("category-target".into()),
                kind: "savings".into(),
                category_id: None,
                amount_in_cents: 20_000,
                enabled: true,
                include_descendants: false,
            },
            &db,
        )
        .await;
        assert!(matches!(invalid, Err(AppError::Validation(_))));
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT kind FROM financial_targets WHERE id='category-target'",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            "category"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT amount_cents FROM financial_targets WHERE id=?",)
                .bind(&canonical)
                .fetch_one(&db)
                .await
                .unwrap(),
            30_000
        );

        delete_financial_target_impl(canonical.clone(), &db)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT is_profile_target FROM financial_targets WHERE id=? AND deleted_at IS NOT NULL",
            )
            .bind(&canonical)
            .fetch_one(&db)
            .await
            .unwrap(),
            1
        );
        let restored = save_financial_target_impl(
            FinancialTargetInput {
                id: Some(canonical.clone()),
                kind: "savings".into(),
                category_id: None,
                amount_in_cents: 40_000,
                enabled: true,
                include_descendants: false,
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(restored, canonical);
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
    async fn savings_report_edit_reuses_the_marked_active_target() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query(
            "INSERT INTO user_profiles(id,display_name,onboarding_completed_at,monthly_target_cents)
             VALUES('primary','Pessoa',datetime('now'),20000)",
        )
        .execute(&db)
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

        let saved = save_financial_target_impl(
            FinancialTargetInput {
                id: None,
                kind: "savings".into(),
                category_id: None,
                amount_in_cents: 55_000,
                enabled: true,
                include_descendants: false,
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(saved, "active-replacement");
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT amount_cents FROM financial_targets WHERE id='active-replacement'",
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            55_000
        );
    }

    async fn insert_expense(
        db: &SqlitePool,
        id: &str,
        date: &str,
        description: &str,
        amount_cents: i64,
    ) {
        insert_transaction(db, id, "acc", date, description, amount_cents, None).await;
    }

    async fn insert_transaction(
        db: &SqlitePool,
        id: &str,
        account_id: &str,
        date: &str,
        description: &str,
        amount_cents: i64,
        category_id: Option<&str>,
    ) {
        let normalized = crate::domain::import::normalize_description(description);
        let key = merchant_key(&normalized);
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,fingerprint,category_id,status)
             VALUES(?,?,?,?,?,?,?,?,?,?)"
        ).bind(id).bind(account_id).bind(date).bind(description).bind(&normalized).bind(&key)
            .bind(amount_cents).bind(format!("fp-{id}")).bind(category_id).bind("cleared").execute(db).await.unwrap();
    }

    #[tokio::test]
    async fn report_groups_normalized_description_variants_into_one_merchant() {
        let (_directory, db, _account_id) = setup().await;
        insert_expense(&db, "t1", "2026-06-01", "SUPERMERCADO BH LTDA", -5000).await;
        insert_expense(
            &db,
            "t2",
            "2026-06-02",
            "COMPRA CARTAO SUPERMERCADO BH 02/06",
            -3000,
        )
        .await;

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(
            report.merchants.len(),
            1,
            "both descriptions must fold into a single merchant"
        );
        assert_eq!(report.merchants[0].amount_in_cents, 8000);
        assert_eq!(report.merchants[0].transaction_count, 2);
    }

    #[tokio::test]
    async fn renaming_a_merchant_alias_reflects_in_the_report() {
        let (_directory, db, _account_id) = setup().await;
        insert_expense(&db, "t1", "2026-06-01", "SUPERMERCADO BH LTDA", -5000).await;
        sqlx::query("INSERT INTO merchant_aliases(id,merchant_key,display_name) VALUES('a1',?,?)")
            .bind(merchant_key("SUPERMERCADO BH LTDA"))
            .bind("Mercadinho da esquina")
            .execute(&db)
            .await
            .unwrap();

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(report.merchants[0].merchant, "Mercadinho da esquina");
    }

    #[tokio::test]
    async fn merchant_admin_searches_before_pagination_and_uses_all_expense_history() {
        let (_directory, db, _account_id) = setup().await;
        insert_expense(&db, "old-1", "2020-01-01", "LOJA ANTIGA", -1000).await;
        insert_expense(&db, "old-2", "2020-02-01", "LOJA ANTIGA", -2000).await;
        insert_expense(&db, "other", "2026-06-01", "PADARIA LOCAL", -500).await;
        insert_transaction(
            &db,
            "income",
            "acc",
            "2026-06-02",
            "LOJA ANTIGA",
            9000,
            None,
        )
        .await;
        insert_expense(&db, "deleted", "2026-06-03", "LOJA ANTIGA", -8000).await;
        sqlx::query("UPDATE transactions SET deleted_at=datetime('now') WHERE id='deleted'")
            .execute(&db)
            .await
            .unwrap();

        let old_key = merchant_key("LOJA ANTIGA");
        sqlx::query(
            "INSERT INTO merchant_aliases(id,merchant_key,display_name) VALUES('alias-old',?,?)",
        )
        .bind(&old_key)
        .bind("Favorita")
        .execute(&db)
        .await
        .unwrap();

        let page = list_merchants_page_impl(
            MerchantPageFilter {
                search: Some("favorita".into()),
                limit: Some(1),
                offset: Some(0),
                sort: None,
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(
            page.total_count, 1,
            "search must be applied before pagination"
        );
        assert_eq!(page.items[0].merchant_key, old_key);
        assert_eq!(page.items[0].original_name, "LOJA ANTIGA");
        assert_eq!(page.items[0].alias.as_deref(), Some("Favorita"));
        assert_eq!(page.items[0].amount_in_cents, 3000);
        assert_eq!(page.items[0].transaction_count, 2);
    }

    #[tokio::test]
    async fn merchant_admin_defaults_to_count_then_name_and_excludes_transfer_legs() {
        let (_directory, db, _account_id) = setup().await;
        insert_expense(&db, "b1", "2026-01-01", "BETA", -100).await;
        insert_expense(&db, "b2", "2026-01-02", "BETA", -100).await;
        insert_expense(&db, "a1", "2026-01-01", "ALFA", -1000).await;
        insert_expense(&db, "a2", "2026-01-02", "ALFA", -1000).await;
        insert_expense(&db, "z1", "2026-01-03", "TRANSFERENCIA TESTE", -7000).await;
        insert_transaction(
            &db,
            "z2",
            "acc",
            "2026-01-03",
            "TRANSFERENCIA TESTE",
            7000,
            None,
        )
        .await;
        sqlx::query("INSERT INTO transaction_links(id,kind,debit_transaction_id,credit_transaction_id) VALUES('link','transfer','z1','z2')")
            .execute(&db).await.unwrap();

        let page = list_merchants_page_impl(
            MerchantPageFilter {
                search: None,
                limit: None,
                offset: None,
                sort: None,
            },
            &db,
        )
        .await
        .unwrap();
        assert_eq!(page.total_count, 2);
        assert_eq!(page.items[0].original_name, "ALFA");
        assert_eq!(page.items[1].original_name, "BETA");
    }

    #[tokio::test]
    async fn bank_report_ignores_credit_card_invoices() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('card','Cartão','credit_card')")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO import_batches(id,file_name,created_at) VALUES('batch-card','card.csv',datetime('now'))")
            .execute(&db).await.unwrap();
        sqlx::query(
            "INSERT INTO credit_card_invoices(id,account_id,due_date,purchases_cents,credits_cents,total_cents,status,import_batch_id)
             VALUES('inv','card','2026-06-10',12000,0,12000,'open','batch-card')"
        ).execute(&db).await.unwrap();

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "bank".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(report.invoices.open_count, 0);
        assert_eq!(report.invoices.open_total_in_cents, 0);
    }

    #[tokio::test]
    async fn category_trend_respects_source_account_and_end_month() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('card','Cartão','credit_card')")
            .execute(&db)
            .await
            .unwrap();
        insert_transaction(&db, "bank-may", "acc", "2026-05-04", "Mercado", -4000, None).await;
        insert_transaction(&db, "bank-jun", "acc", "2026-06-04", "Mercado", -5000, None).await;
        insert_transaction(
            &db,
            "card-jun",
            "card",
            "2026-06-04",
            "Mercado",
            -9000,
            None,
        )
        .await;

        let trend = category_trend_impl(
            CategoryTrendFilter {
                category_id: None,
                end_month: "2026-06".into(),
                source: "bank".into(),
                account_id: Some("acc".into()),
                months: 2,
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(
            trend
                .iter()
                .map(|p| (p.month.as_str(), p.amount_in_cents))
                .collect::<Vec<_>>(),
            vec![("2026-05", 4000), ("2026-06", 5000),]
        );
    }

    #[tokio::test]
    async fn dashboard_summary_matches_report_for_credit_card_refund() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('card','Cartão','credit_card')")
            .execute(&db)
            .await
            .unwrap();
        // A credit-card refund (positive amount on a credit_card account) must never be counted
        // as income by either the dashboard or the report.
        insert_transaction(
            &db,
            "refund",
            "card",
            "2026-06-05",
            "Estorno loja",
            3000,
            None,
        )
        .await;
        // A positive amount tagged with an expense-kind category should reduce expenses, not add
        // income.
        sqlx::query("INSERT INTO categories(id,name,kind) VALUES('cat-exp','Mercado','expense')")
            .execute(&db)
            .await
            .unwrap();
        insert_transaction(
            &db,
            "exp-refund",
            "acc",
            "2026-06-06",
            "Estorno mercado",
            1500,
            Some("cat-exp"),
        )
        .await;
        insert_expense(&db, "regular", "2026-06-07", "Aluguel", -20000).await;
        insert_transaction(&db, "salary", "acc", "2026-06-01", "Salario", 500000, None).await;

        let dashboard = dashboard_summary_data(&db, "2026-06").await.unwrap();
        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(
            dashboard.income_in_cents,
            report.latest_month_summary.income_in_cents
        );
        assert_eq!(
            dashboard.expenses_in_cents,
            report.latest_month_summary.expenses_in_cents
        );
        assert_eq!(
            dashboard.investments_in_cents,
            report.latest_month_summary.investments_in_cents
        );
        // The credit-card refund must not have been counted as income.
        assert_eq!(dashboard.income_in_cents, 500000);
    }

    #[tokio::test]
    async fn report_nets_reversals_redemptions_and_excludes_linked_movements() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query(
            "INSERT INTO categories(id,name,kind) VALUES('test-expense','Despesa','expense')",
        )
        .execute(&db)
        .await
        .unwrap();
        insert_transaction(
            &db,
            "salary",
            "acc",
            "2026-06-01",
            "Salário",
            500_000,
            Some("salary"),
        )
        .await;
        insert_transaction(
            &db,
            "salary-reversal",
            "acc",
            "2026-06-02",
            "Reversão salarial",
            -50_000,
            Some("salary"),
        )
        .await;
        insert_transaction(
            &db,
            "expense",
            "acc",
            "2026-06-03",
            "Despesa",
            -100_000,
            Some("test-expense"),
        )
        .await;
        insert_transaction(
            &db,
            "expense-refund",
            "acc",
            "2026-06-04",
            "Estorno",
            20_000,
            Some("test-expense"),
        )
        .await;
        insert_transaction(
            &db,
            "contribution",
            "acc",
            "2026-06-05",
            "Aporte",
            -80_000,
            Some("investments"),
        )
        .await;
        insert_transaction(
            &db,
            "redemption",
            "acc",
            "2026-06-06",
            "Resgate",
            30_000,
            Some("investments"),
        )
        .await;
        insert_transaction(
            &db,
            "transfer-debit",
            "acc",
            "2026-06-07",
            "Transferência",
            -70_000,
            Some("test-expense"),
        )
        .await;
        insert_transaction(
            &db,
            "transfer-credit",
            "acc",
            "2026-06-07",
            "Transferência",
            70_000,
            Some("salary"),
        )
        .await;
        insert_transaction(
            &db,
            "payment-debit",
            "acc",
            "2026-06-08",
            "Pagamento de cartão",
            -40_000,
            Some("test-expense"),
        )
        .await;
        insert_transaction(
            &db,
            "payment-credit",
            "acc",
            "2026-06-08",
            "Pagamento de cartão",
            40_000,
            Some("salary"),
        )
        .await;
        sqlx::query(
            "INSERT INTO transaction_links(id,kind,debit_transaction_id,credit_transaction_id)
             VALUES('transfer-link','transfer','transfer-debit','transfer-credit'),
                   ('payment-link','credit_card_payment','payment-debit','payment-credit')",
        )
        .execute(&db)
        .await
        .unwrap();

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(report.summary.income_in_cents, 450_000);
        assert_eq!(report.summary.expenses_in_cents, 80_000);
        assert_eq!(report.summary.investments_in_cents, 50_000);
        assert_eq!(report.summary.savings_in_cents, 370_000);
        assert_eq!(report.latest_month_summary.income_in_cents, 450_000);
        assert!(report
            .kind_breakdown
            .iter()
            .flat_map(|kind| &kind.categories)
            .all(|category| category.share_percent <= 100.0));
    }

    #[tokio::test]
    async fn refund_denominators_keep_visible_shares_at_or_below_one_hundred_percent() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('card','Cartão','credit_card')")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO categories(id,name,kind) VALUES
               ('expense-a','Despesa A','expense'),
               ('expense-b','Despesa B','expense')",
        )
        .execute(&db)
        .await
        .unwrap();
        insert_transaction(
            &db,
            "bank-expense",
            "acc",
            "2026-06-01",
            "Despesa",
            -10_000,
            Some("expense-a"),
        )
        .await;
        insert_transaction(
            &db,
            "card-refund",
            "card",
            "2026-06-02",
            "Estorno",
            9_000,
            Some("expense-b"),
        )
        .await;

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(report.summary.expenses_in_cents, 1_000);
        assert!(report
            .categories
            .iter()
            .all(|category| category.share_percent <= 100.0));
        assert!(report
            .sources
            .iter()
            .all(|source| source.share_percent <= 100.0));
        assert!(report.card_share_percent <= 100.0);
    }

    #[tokio::test]
    async fn goals_are_global_even_when_report_is_filtered_to_one_account() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('other','Outra conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO categories(id,name,kind) VALUES('goal-expense','Meta','expense')")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO financial_targets(id,kind,category_id,amount_cents,enabled) VALUES
               ('goal-savings-global','savings',NULL,100000,1),
               ('goal-category-global','category','goal-expense',100000,1)",
        )
        .execute(&db)
        .await
        .unwrap();
        insert_transaction(
            &db,
            "income-a",
            "acc",
            "2026-06-01",
            "Renda A",
            10_000,
            None,
        )
        .await;
        insert_transaction(
            &db,
            "expense-a",
            "acc",
            "2026-06-02",
            "Despesa A",
            -2_000,
            Some("goal-expense"),
        )
        .await;
        insert_transaction(
            &db,
            "income-b",
            "other",
            "2026-06-01",
            "Renda B",
            20_000,
            None,
        )
        .await;
        insert_transaction(
            &db,
            "expense-b",
            "other",
            "2026-06-02",
            "Despesa B",
            -5_000,
            Some("goal-expense"),
        )
        .await;

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "bank".into(),
                account_id: Some("acc".into()),
            },
            &db,
        )
        .await
        .unwrap();

        assert_eq!(report.latest_month_summary.savings_in_cents, 8_000);
        let savings = report
            .goals
            .iter()
            .find(|goal| goal.kind == "savings")
            .unwrap();
        let category = report
            .goals
            .iter()
            .find(|goal| goal.kind == "category")
            .unwrap();
        assert_eq!(savings.actual_in_cents, 23_000);
        assert_eq!(category.actual_in_cents, 7_000);
    }

    #[tokio::test]
    async fn category_goal_can_include_nested_subcategories() {
        let (_directory, db, _account_id) = setup().await;
        sqlx::query(
            "INSERT INTO categories(id,parent_id,name,kind) VALUES
             ('goal-family',NULL,'Casa','expense'),
             ('goal-child','goal-family','Contas','expense'),
             ('goal-grandchild','goal-child','Energia','expense')",
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO financial_targets(
               id,kind,category_id,amount_cents,enabled,include_descendants
             ) VALUES('goal-family-target','category','goal-family',100000,1,1)",
        )
        .execute(&db)
        .await
        .unwrap();
        insert_transaction(
            &db,
            "goal-parent-expense",
            "acc",
            "2026-06-01",
            "Casa",
            -10_000,
            Some("goal-family"),
        )
        .await;
        insert_transaction(
            &db,
            "goal-child-expense",
            "acc",
            "2026-06-02",
            "Conta",
            -20_000,
            Some("goal-child"),
        )
        .await;
        insert_transaction(
            &db,
            "goal-grandchild-expense",
            "acc",
            "2026-06-03",
            "Energia",
            -30_000,
            Some("goal-grandchild"),
        )
        .await;

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-06".into(),
                end_month: "2026-06".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        let goal = report
            .goals
            .iter()
            .find(|goal| goal.target_id == "goal-family-target")
            .unwrap();
        assert_eq!(goal.actual_in_cents, 60_000);
    }

    #[tokio::test]
    async fn savings_goal_projects_pro_rata_for_the_current_month() {
        let (_directory, db, _account_id) = setup().await;
        let today = Local::now().date_naive();
        let current_month = today.format("%Y-%m").to_string();
        sqlx::query("INSERT INTO financial_targets(id,kind,category_id,amount_cents,enabled) VALUES('goal-savings','savings',NULL,100000,1)")
            .execute(&db).await.unwrap();
        // Half the current savings target reached; income minus expenses so far.
        insert_transaction(
            &db,
            "income",
            "acc",
            &format!("{current_month}-01"),
            "Salario",
            200000,
            None,
        )
        .await;
        insert_expense(
            &db,
            "expense",
            &format!("{current_month}-02"),
            "Contas",
            -150000,
        )
        .await;

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: current_month.clone(),
                end_month: current_month.clone(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();
        let goal = report
            .goals
            .iter()
            .find(|g| g.kind == "savings")
            .expect("savings goal");
        let elapsed = effective_days(&current_month).max(1);
        let total_days = days_in_month(&current_month);
        if elapsed < total_days {
            // Pro-rated projection must scale up the partial actual, not just echo it back.
            assert!(
                goal.projected_in_cents > goal.actual_in_cents,
                "projected {} should exceed partial actual {} mid-month",
                goal.projected_in_cents,
                goal.actual_in_cents
            );
        }
    }

    #[tokio::test]
    async fn period_daily_average_accounts_for_each_months_own_length() {
        let (_directory, db, _account_id) = setup().await;
        // January has 31 days, February (2026, non-leap) has 28 — both fully in the past.
        insert_expense(&db, "jan", "2026-01-15", "Despesa janeiro", -3100).await;
        insert_expense(&db, "feb", "2026-02-15", "Despesa fevereiro", -2800).await;

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-01".into(),
                end_month: "2026-02".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        // Total expenses (5900) over 31+28=59 days = 100 cents/day, not 5900/2/28 (~105) which the
        // old buggy formula (using only the last month's day count) would have produced.
        assert_eq!(report.summary.daily_average_in_cents, 100);
    }

    #[tokio::test]
    async fn highest_spending_day_uses_whole_filtered_period() {
        let (_directory, db, _account_id) = setup().await;
        insert_expense(&db, "may-big", "2026-05-03", "Compra maior", -10000).await;
        insert_expense(&db, "jun-small", "2026-06-03", "Compra menor", -5000).await;

        let report = generate_financial_report_impl(
            ReportFilter {
                start_month: "2026-05".into(),
                end_month: "2026-06".into(),
                source: "all".into(),
                account_id: None,
            },
            &db,
        )
        .await
        .unwrap();

        let highest = report.highest_spending_day.expect("highest spending day");
        assert_eq!(highest.date, "2026-05-03");
        assert_eq!(highest.amount_in_cents, 10000);
        assert_eq!(
            report.daily.len(),
            1,
            "cumulative chart still describes the final month"
        );
    }
}
