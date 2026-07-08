use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, HashMap};
use tauri::State;
use uuid::Uuid;

use crate::{application::state::AppState, error::AppError};

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
    merchant_key: Option<String>,
    amount_in_cents: i64,
    transaction_count: i64,
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
         a.kind account_kind, t.category_id, c.name category_name, c.color category_color, c.kind category_kind
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
    let mut income = 0i64;
    let mut expenses = 0i64;
    let mut investments = 0i64;
    let mut balance = 0i64;
    let mut category_map: HashMap<Option<String>, (String, i64)> = HashMap::new();
    for row in &rows {
        income += income_value(row);
        expenses += expense_value(row);
        investments += investment_value(row);
        balance += row.amount;
        let expense = expense_value(row);
        if expense > 0 {
            let entry = category_map.entry(row.category_id.clone()).or_insert((
                row.category_name
                    .clone()
                    .unwrap_or_else(|| "Sem categoria".into()),
                0,
            ));
            entry.1 += expense;
        }
    }
    let mut by_category: Vec<(String, i64)> = category_map.into_values().collect();
    by_category.sort_by(|a, b| b.1.cmp(&a.1));
    by_category.truncate(6);
    Ok(DashboardSummaryData {
        income_in_cents: income,
        expenses_in_cents: expenses.max(0),
        investments_in_cents: investments,
        balance_in_cents: balance,
        transaction_count: rows.len() as i64,
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
        Some((current - previous) as f64 / previous.abs() as f64 * 100.0)
    }
}

pub(crate) fn expense_value(row: &ReportRow) -> i64 {
    match row.category_kind.as_deref() {
        Some("transfer") | Some("investment") | Some("income") => 0,
        Some("expense") => -row.amount,
        _ if row.account_kind == "credit_card" => -row.amount,
        _ if row.amount < 0 => -row.amount,
        _ => 0,
    }
}

pub(crate) fn income_value(row: &ReportRow) -> i64 {
    if row.account_kind == "credit_card" {
        return 0;
    }
    match row.category_kind.as_deref() {
        Some("transfer") | Some("investment") | Some("expense") => 0,
        Some("income") => row.amount.max(0),
        _ => row.amount.max(0),
    }
}

pub(crate) fn investment_value(row: &ReportRow) -> i64 {
    if row.category_kind.as_deref() == Some("investment") {
        (-row.amount).max(0)
    } else {
        0
    }
}

fn summarize(rows: &[ReportRow], month: &str) -> ReportSummary {
    let month_rows = rows.iter().filter(|r| r.month == month);
    let mut result = ReportSummary::default();
    for row in month_rows {
        result.income_in_cents += income_value(row);
        result.expenses_in_cents += expense_value(row);
        result.investments_in_cents += investment_value(row);
    }
    result.expenses_in_cents = result.expenses_in_cents.max(0);
    result.savings_in_cents = result.income_in_cents - result.expenses_in_cents;
    result.savings_rate_percent = (result.income_in_cents > 0)
        .then_some(result.savings_in_cents as f64 / result.income_in_cents as f64 * 100.0);
    result
}

fn summarize_period(rows: &[&ReportRow]) -> ReportSummary {
    let mut result = ReportSummary::default();
    for row in rows {
        result.income_in_cents += income_value(row);
        result.expenses_in_cents += expense_value(row);
        result.investments_in_cents += investment_value(row);
    }
    result.expenses_in_cents = result.expenses_in_cents.max(0);
    result.savings_in_cents = result.income_in_cents - result.expenses_in_cents;
    result.savings_rate_percent = (result.income_in_cents > 0)
        .then_some(result.savings_in_cents as f64 / result.income_in_cents as f64 * 100.0);
    result
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
        "SELECT t.id,t.kind,t.category_id,c.name category_name,t.amount_cents,t.enabled
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
            overrides,
        });
    }
    Ok(targets)
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
        .fetch_optional(&state.db)
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
    if input.kind == "savings" {
        let other:i64=sqlx::query_scalar(
            "SELECT COUNT(*) FROM financial_targets WHERE kind='savings' AND deleted_at IS NULL AND id!=?"
        ).bind(input.id.as_deref().unwrap_or("")).fetch_one(&state.db).await?;
        if other > 0 {
            return Err(AppError::Validation(
                "Já existe uma meta recorrente de economia".into(),
            ));
        }
    }
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO financial_targets(id,kind,category_id,amount_cents,enabled) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,category_id=excluded.category_id,
         amount_cents=excluded.amount_cents,enabled=excluded.enabled,updated_at=datetime('now')",
    )
    .bind(&id)
    .bind(input.kind)
    .bind(input.category_id)
    .bind(input.amount_in_cents)
    .bind(input.enabled as i64)
    .execute(&state.db)
    .await?;
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
    sqlx::query("UPDATE financial_targets SET deleted_at=datetime('now'),enabled=0 WHERE id=?")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn generate_financial_report(
    filter: ReportFilter,
    state: State<'_, AppState>,
) -> Result<FinancialReport, AppError> {
    generate_financial_report_impl(filter, &state.db).await
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
         a.kind account_kind, t.category_id, c.name category_name, c.color category_color, c.kind category_kind
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
        })
        .collect();

    let mut monthly = vec![];
    for month in &months {
        let summary = summarize(&report_rows, month);
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
    let mut summary = summarize_period(&period_rows);
    let mut latest_month_summary = summarize(&report_rows, &filter.end_month);
    let previous_summary = summarize(&report_rows, &previous_month);
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
    latest_month_summary.projected_expenses_in_cents = ((latest_month_summary.expenses_in_cents
        as i128
        * days_in_month(&filter.end_month) as i128)
        / elapsed as i128) as i64;
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
    let mut current_category_map: HashMap<Option<String>, i64> = HashMap::new();
    let mut merchant_map: HashMap<String, (String, Option<String>, i64, i64)> = HashMap::new();
    let mut daily_map: BTreeMap<String, i64> = BTreeMap::new();
    let mut period_daily_map: BTreeMap<String, i64> = BTreeMap::new();
    let mut bank = 0;
    let mut card = 0;
    let mut uncategorized_count = 0;
    let mut uncategorized = 0;
    for row in &period_rows {
        let expense = expense_value(row);
        if expense == 0 {
            continue;
        }
        *period_daily_map.entry(row.date.clone()).or_default() += expense;
        let category = category_map.entry(row.category_id.clone()).or_insert((
            row.category_name
                .clone()
                .unwrap_or_else(|| "Sem categoria".into()),
            row.category_color.clone(),
            0,
        ));
        category.2 += expense;
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
        merchant.2 += expense;
        merchant.3 += 1;
        if row.account_kind == "credit_card" {
            card += expense
        } else {
            bank += expense
        }
        if row.category_id.is_none() {
            uncategorized_count += 1;
            uncategorized += expense
        }
    }
    for row in current_rows {
        let expense = expense_value(row);
        if expense == 0 {
            continue;
        }
        *daily_map.entry(row.date.clone()).or_default() += expense;
        *current_category_map
            .entry(row.category_id.clone())
            .or_default() += expense;
    }
    let total = summary.expenses_in_cents.max(1);
    let mut categories: Vec<_> = category_map
        .into_iter()
        .map(|(id, (name, color, amount))| CategoryReport {
            category_id: id,
            category: name,
            color,
            amount_in_cents: amount.max(0),
            share_percent: amount.max(0) as f64 / total as f64 * 100.0,
        })
        .collect();
    categories.sort_by_key(|x| -x.amount_in_cents);

    // Build per-kind breakdown (income, expense, investment) by aggregating signed amounts
    // per category. For income/investment we use positive amounts; for expense we use the
    // expense_value (positive spend). This powers separate donuts in the UI.
    let mut kind_map: HashMap<String, HashMap<Option<String>, (String, Option<String>, i64)>> =
        HashMap::new();
    for row in &period_rows {
        let kind = row.category_kind.clone().unwrap_or_else(|| {
            if row.amount > 0 {
                "income".into()
            } else {
                "expense".into()
            }
        });
        let signed = match kind.as_str() {
            "income" => income_value(row),
            "investment" => investment_value(row),
            _ => expense_value(row),
        };
        if signed == 0 {
            continue;
        }
        let entry = kind_map.entry(kind.clone()).or_default();
        let cat = entry.entry(row.category_id.clone()).or_insert((
            row.category_name
                .clone()
                .unwrap_or_else(|| "Sem categoria".into()),
            row.category_color.clone(),
            0,
        ));
        cat.2 += signed;
    }
    let mut kind_breakdown: Vec<_> = kind_map
        .into_iter()
        .map(|(kind, inner)| {
            let kind_total: i64 = inner.values().map(|x| x.2.max(0)).sum();
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
            KindBreakdown {
                kind: kind.clone(),
                total_in_cents: kind_total,
                categories: list,
            }
        })
        .collect();
    kind_breakdown.sort_by_key(|k| match k.kind.as_str() {
        "income" => 0,
        "expense" => 1,
        "investment" => 2,
        _ => 3,
    });

    let mut merchants: Vec<_> = merchant_map
        .into_iter()
        .map(|(_, (label, key, amount, count))| MerchantReport {
            merchant: label,
            merchant_key: key,
            amount_in_cents: amount.max(0),
            transaction_count: count,
        })
        .collect();
    merchants.sort_by_key(|x| -x.amount_in_cents);
    merchants.truncate(8);
    let mut cumulative = 0;
    let daily: Vec<_> = daily_map
        .into_iter()
        .map(|(date, amount)| {
            cumulative += amount;
            DailyReportPoint {
                date,
                amount_in_cents: amount,
                cumulative_in_cents: cumulative,
            }
        })
        .collect();
    let mut period_cumulative = 0;
    let highest_spending_day = period_daily_map
        .into_iter()
        .map(|(date, amount)| {
            period_cumulative += amount;
            DailyReportPoint {
                date,
                amount_in_cents: amount,
                cumulative_in_cents: period_cumulative,
            }
        })
        .max_by_key(|x| x.amount_in_cents);
    let sources = vec![
        SourceReport {
            source: "bank".into(),
            amount_in_cents: bank.max(0),
            share_percent: bank.max(0) as f64 / total as f64 * 100.0,
        },
        SourceReport {
            source: "credit_card".into(),
            amount_in_cents: card.max(0),
            share_percent: card.max(0) as f64 / total as f64 * 100.0,
        },
    ];

    let targets = load_targets(db).await?;
    let mut goals = vec![];
    for target in targets.into_iter().filter(|t| t.enabled) {
        let target_amount = target
            .overrides
            .iter()
            .find(|o| o.month == filter.end_month)
            .map(|o| o.amount_in_cents)
            .unwrap_or(target.amount_in_cents);
        let actual = if target.kind == "savings" {
            latest_month_summary.savings_in_cents
        } else {
            current_category_map
                .get(&target.category_id)
                .copied()
                .unwrap_or(0)
                .max(0)
        };
        let is_current_month =
            filter.end_month == Local::now().date_naive().format("%Y-%m").to_string();
        let projected = if target.kind == "savings" {
            if is_current_month {
                let days = days_in_month(&filter.end_month) as i128;
                let projected_income =
                    (latest_month_summary.income_in_cents as i128 * days) / elapsed as i128;
                projected_income as i64 - latest_month_summary.projected_expenses_in_cents
            } else {
                // Past (or future) months: the month is fully elapsed, so the actual figure is final.
                actual
            }
        } else if is_current_month {
            // Pro-rate the current month's partial category spend to a full-month projection.
            ((actual as i128 * days_in_month(&filter.end_month) as i128) / elapsed as i128) as i64
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
            remaining_in_cents: target_amount - actual,
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
        monthly.iter().map(|x| x.expenses_in_cents).sum::<i64>() / monthly.len() as i64
    };
    let card_share = card.max(0) as f64 / total as f64 * 100.0;
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
