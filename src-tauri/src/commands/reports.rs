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
pub struct MerchantReport {
    merchant: String,
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
    previous_summary: ReportSummary,
    monthly: Vec<MonthlyReportPoint>,
    categories: Vec<CategoryReport>,
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
    month: String,
    amount_in_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialTarget {
    id: String,
    kind: String,
    category_id: Option<String>,
    category_name: Option<String>,
    amount_in_cents: i64,
    enabled: bool,
    overrides: Vec<TargetOverride>,
}

#[derive(Clone)]
struct ReportRow {
    date: String,
    month: String,
    description: String,
    amount: i64,
    account_kind: String,
    category_id: Option<String>,
    category_name: Option<String>,
    category_color: Option<String>,
    category_kind: Option<String>,
}

fn parse_month(value: &str) -> Result<(i32, u32), AppError> {
    let date = NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Período mensal inválido".into()))?;
    Ok((date.year(), date.month()))
}

fn shift_month(value: &str, delta: i32) -> Result<String, AppError> {
    let (year, month) = parse_month(value)?;
    let index = year * 12 + month as i32 - 1 + delta;
    Ok(format!("{:04}-{:02}", index.div_euclid(12), index.rem_euclid(12) + 1))
}

fn month_range(start: &str, end: &str) -> Result<Vec<String>, AppError> {
    parse_month(start)?;
    parse_month(end)?;
    if start > end { return Err(AppError::Validation("O início não pode ser posterior ao fim".into())); }
    let mut result=vec![];
    let mut current=start.to_string();
    while current.as_str() <= end {
        result.push(current.clone());
        if result.len() > 60 { return Err(AppError::Validation("O período máximo é de 60 meses".into())); }
        current=shift_month(&current,1)?;
    }
    Ok(result)
}

fn percent_change(current: i64, previous: i64) -> Option<f64> {
    if previous == 0 { None } else { Some((current - previous) as f64 / previous.abs() as f64 * 100.0) }
}

fn expense_value(row: &ReportRow) -> i64 {
    match row.category_kind.as_deref() {
        Some("transfer") | Some("investment") | Some("income") => 0,
        Some("expense") => -row.amount,
        _ if row.account_kind == "credit_card" => -row.amount,
        _ if row.amount < 0 => -row.amount,
        _ => 0,
    }
}

fn income_value(row: &ReportRow) -> i64 {
    if row.account_kind == "credit_card" { return 0; }
    match row.category_kind.as_deref() {
        Some("transfer") | Some("investment") | Some("expense") => 0,
        Some("income") => row.amount.max(0),
        _ => row.amount.max(0),
    }
}

fn investment_value(row: &ReportRow) -> i64 {
    if row.category_kind.as_deref() == Some("investment") { (-row.amount).max(0) } else { 0 }
}

fn summarize(rows: &[ReportRow], month: &str) -> ReportSummary {
    let month_rows=rows.iter().filter(|r|r.month==month);
    let mut result=ReportSummary::default();
    for row in month_rows {
        result.income_in_cents += income_value(row);
        result.expenses_in_cents += expense_value(row);
        result.investments_in_cents += investment_value(row);
    }
    result.expenses_in_cents=result.expenses_in_cents.max(0);
    result.savings_in_cents=result.income_in_cents-result.expenses_in_cents;
    result.savings_rate_percent=(result.income_in_cents>0)
        .then_some(result.savings_in_cents as f64/result.income_in_cents as f64*100.0);
    result
}

fn days_in_month(month: &str) -> i64 {
    let next=shift_month(month,1).unwrap();
    let date=NaiveDate::parse_from_str(&format!("{next}-01"),"%Y-%m-%d").unwrap();
    date.pred_opt().unwrap().day() as i64
}

fn effective_days(month: &str) -> i64 {
    let today=Local::now().date_naive();
    if month==today.format("%Y-%m").to_string() { today.day() as i64 } else { days_in_month(month) }
}

async fn load_targets(db:&SqlitePool) -> Result<Vec<FinancialTarget>,AppError> {
    let rows=sqlx::query(
        "SELECT t.id,t.kind,t.category_id,c.name category_name,t.amount_cents,t.enabled
         FROM financial_targets t LEFT JOIN categories c ON c.id=t.category_id
         WHERE t.deleted_at IS NULL ORDER BY t.kind,c.name"
    ).fetch_all(db).await?;
    let mut targets=vec![];
    for row in rows {
        let id:String=row.get("id");
        let overrides=sqlx::query("SELECT month,amount_cents FROM financial_target_overrides WHERE target_id=? ORDER BY month")
            .bind(&id).fetch_all(db).await?.into_iter().map(|o|TargetOverride{
                month:o.get("month"),amount_in_cents:o.get("amount_cents")
            }).collect();
        targets.push(FinancialTarget{
            id,kind:row.get("kind"),category_id:row.get("category_id"),category_name:row.get("category_name"),
            amount_in_cents:row.get("amount_cents"),enabled:row.get::<i64,_>("enabled")!=0,overrides
        });
    }
    Ok(targets)
}

#[tauri::command]
pub async fn list_financial_targets(state:State<'_,AppState>)->Result<Vec<FinancialTarget>,AppError>{
    load_targets(&state.db).await
}

#[tauri::command]
pub async fn save_financial_target(input:FinancialTargetInput,state:State<'_,AppState>)->Result<String,AppError>{
    if input.amount_in_cents<=0 || !["savings","category"].contains(&input.kind.as_str()) {
        return Err(AppError::Validation("Tipo e valor positivo são obrigatórios".into()));
    }
    if input.kind=="category" {
        let id=input.category_id.as_ref().ok_or_else(||AppError::Validation("Escolha uma categoria".into()))?;
        let kind=sqlx::query_scalar::<_,String>("SELECT kind FROM categories WHERE id=? AND deleted_at IS NULL")
            .bind(id).fetch_optional(&state.db).await?.ok_or_else(||AppError::Validation("Categoria não encontrada".into()))?;
        if kind!="expense" { return Err(AppError::Validation("Metas de categoria exigem uma categoria de despesa".into())); }
    } else if input.category_id.is_some() {
        return Err(AppError::Validation("Meta de economia não aceita categoria".into()));
    }
    if input.kind=="savings" {
        let other:i64=sqlx::query_scalar(
            "SELECT COUNT(*) FROM financial_targets WHERE kind='savings' AND deleted_at IS NULL AND id!=?"
        ).bind(input.id.as_deref().unwrap_or("")).fetch_one(&state.db).await?;
        if other>0 { return Err(AppError::Validation("Já existe uma meta recorrente de economia".into())); }
    }
    let id=input.id.unwrap_or_else(||Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO financial_targets(id,kind,category_id,amount_cents,enabled) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,category_id=excluded.category_id,
         amount_cents=excluded.amount_cents,enabled=excluded.enabled,updated_at=datetime('now')"
    ).bind(&id).bind(input.kind).bind(input.category_id).bind(input.amount_in_cents)
        .bind(input.enabled as i64).execute(&state.db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn save_financial_target_override(
    target_id:String,month:String,amount_in_cents:i64,state:State<'_,AppState>
)->Result<(),AppError>{
    parse_month(&month)?;
    if amount_in_cents<=0{return Err(AppError::Validation("A meta mensal deve ser positiva".into()));}
    sqlx::query(
        "INSERT INTO financial_target_overrides(id,target_id,month,amount_cents) VALUES(?,?,?,?)
         ON CONFLICT(target_id,month) DO UPDATE SET amount_cents=excluded.amount_cents,updated_at=datetime('now')"
    ).bind(Uuid::new_v4().to_string()).bind(target_id).bind(month).bind(amount_in_cents)
        .execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_financial_target(id:String,state:State<'_,AppState>)->Result<(),AppError>{
    sqlx::query("UPDATE financial_targets SET deleted_at=datetime('now'),enabled=0 WHERE id=?")
        .bind(id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn generate_financial_report(filter:ReportFilter,state:State<'_,AppState>)->Result<FinancialReport,AppError>{
    let months=month_range(&filter.start_month,&filter.end_month)?;
    if !["all","bank","credit_card"].contains(&filter.source.as_str()){
        return Err(AppError::Validation("Origem de relatório inválida".into()));
    }
    if let Some(account_id)=&filter.account_id {
        let exists:i64=sqlx::query_scalar("SELECT COUNT(*) FROM accounts WHERE id=? AND deleted_at IS NULL")
            .bind(account_id).fetch_one(&state.db).await?;
        if exists==0{return Err(AppError::Validation("Conta não encontrada".into()));}
    }
    let previous_month=shift_month(&filter.end_month,-1)?;
    let query_start=if previous_month<filter.start_month{previous_month.clone()}else{filter.start_month.clone()};
    let rows=sqlx::query(
        "SELECT COALESCE(i.due_date, t.date) as date, strftime('%Y-%m', COALESCE(i.due_date, t.date)) month,
         t.description, t.amount_cents,
         a.kind account_kind, t.category_id, c.name category_name, c.color category_color, c.kind category_kind
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         LEFT JOIN credit_card_invoice_items x ON x.transaction_id=t.id
         LEFT JOIN credit_card_invoices i ON i.id=x.invoice_id
         WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
         AND strftime('%Y-%m', COALESCE(i.due_date, t.date)) >= ? AND strftime('%Y-%m', COALESCE(i.due_date, t.date)) <= ?
         AND (?='all' OR (?='bank' AND a.kind!='credit_card') OR (?='credit_card' AND a.kind='credit_card'))
         AND (? IS NULL OR t.account_id=?)"
    ).bind(&query_start).bind(&filter.end_month).bind(&filter.source).bind(&filter.source)
        .bind(&filter.source).bind(&filter.account_id).bind(&filter.account_id)
        .fetch_all(&state.db).await?;
    let report_rows:Vec<ReportRow>=rows.into_iter().map(|r|ReportRow{
        date:r.get("date"),month:r.get("month"),description:r.get("description"),amount:r.get("amount_cents"),
        account_kind:r.get("account_kind"),category_id:r.get("category_id"),category_name:r.get("category_name"),
        category_color:r.get("category_color"),category_kind:r.get("category_kind")
    }).collect();

    let mut monthly=vec![];
    for month in &months {
        let summary=summarize(&report_rows,month);
        monthly.push(MonthlyReportPoint{
            month:month.clone(),income_in_cents:summary.income_in_cents,expenses_in_cents:summary.expenses_in_cents,
            investments_in_cents:summary.investments_in_cents,savings_in_cents:summary.savings_in_cents,
            savings_rate_percent:summary.savings_rate_percent
        });
    }
    let mut summary=summarize(&report_rows,&filter.end_month);
    let previous_summary=summarize(&report_rows,&previous_month);
    summary.income_change_percent=percent_change(summary.income_in_cents,previous_summary.income_in_cents);
    summary.expense_change_percent=percent_change(summary.expenses_in_cents,previous_summary.expenses_in_cents);
    summary.savings_change_percent=percent_change(summary.savings_in_cents,previous_summary.savings_in_cents);
    let elapsed=effective_days(&filter.end_month).max(1);
    summary.daily_average_in_cents=summary.expenses_in_cents/elapsed;
    summary.projected_expenses_in_cents=summary.daily_average_in_cents*days_in_month(&filter.end_month);

    let current_rows:Vec<_>=report_rows.iter().filter(|r|r.month==filter.end_month).collect();
    let mut category_map:HashMap<Option<String>,(String,Option<String>,i64)>=HashMap::new();
    let mut merchant_map:HashMap<String,(i64,i64)>=HashMap::new();
    let mut daily_map:BTreeMap<String,i64>=BTreeMap::new();
    let mut bank=0;let mut card=0;let mut uncategorized_count=0;let mut uncategorized=0;
    for row in current_rows {
        let expense=expense_value(row);
        if expense==0{continue}
        let category=category_map.entry(row.category_id.clone()).or_insert((
            row.category_name.clone().unwrap_or_else(||"Sem categoria".into()),row.category_color.clone(),0
        ));category.2+=expense;
        let merchant=merchant_map.entry(row.description.clone()).or_insert((0,0));merchant.0+=expense;merchant.1+=1;
        *daily_map.entry(row.date.clone()).or_default()+=expense;
        if row.account_kind=="credit_card"{card+=expense}else{bank+=expense}
        if row.category_id.is_none(){uncategorized_count+=1;uncategorized+=expense}
    }
    let total=summary.expenses_in_cents.max(1);
    let mut categories:Vec<_>=category_map.into_iter().map(|(id,(name,color,amount))|CategoryReport{
        category_id:id,category:name,color,amount_in_cents:amount.max(0),
        share_percent:amount.max(0) as f64/total as f64*100.0
    }).collect();categories.sort_by_key(|x|-x.amount_in_cents);
    let mut merchants:Vec<_>=merchant_map.into_iter().map(|(merchant,(amount,count))|MerchantReport{
        merchant,amount_in_cents:amount.max(0),transaction_count:count
    }).collect();merchants.sort_by_key(|x|-x.amount_in_cents);merchants.truncate(8);
    let mut cumulative=0;
    let daily:Vec<_>=daily_map.into_iter().map(|(date,amount)|{cumulative+=amount;DailyReportPoint{
        date,amount_in_cents:amount,cumulative_in_cents:cumulative
    }}).collect();
    let highest_spending_day=daily.iter().max_by_key(|x|x.amount_in_cents).cloned();
    let sources=vec![
        SourceReport{source:"bank".into(),amount_in_cents:bank.max(0),share_percent:bank.max(0) as f64/total as f64*100.0},
        SourceReport{source:"credit_card".into(),amount_in_cents:card.max(0),share_percent:card.max(0) as f64/total as f64*100.0},
    ];

    let targets=load_targets(&state.db).await?;
    let mut goals=vec![];
    for target in targets.into_iter().filter(|t|t.enabled) {
        let target_amount=target.overrides.iter().find(|o|o.month==filter.end_month)
            .map(|o|o.amount_in_cents).unwrap_or(target.amount_in_cents);
        let actual=if target.kind=="savings"{summary.savings_in_cents}else{
            categories.iter().find(|c|c.category_id==target.category_id).map(|c|c.amount_in_cents).unwrap_or(0)
        };
        let projected=if target.kind=="savings"{actual}else{actual/elapsed*days_in_month(&filter.end_month)};
        goals.push(GoalProgress{
            target_id:target.id,kind:target.kind.clone(),category_id:target.category_id,
            label:target.category_name.unwrap_or_else(||"Economia mensal".into()),target_in_cents:target_amount,
            actual_in_cents:actual,remaining_in_cents:target_amount-actual,
            progress_percent:actual as f64/target_amount as f64*100.0,projected_in_cents:projected,
            projected_to_exceed:if target.kind=="savings"{projected<target_amount}else{projected>target_amount}
        });
    }

    let invoice=sqlx::query(
        "SELECT COALESCE(SUM(CASE WHEN status='open' THEN 1 ELSE 0 END),0) open_count,
         COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) paid_count,
         COALESCE(SUM(CASE WHEN status='open' THEN total_cents ELSE 0 END),0) open_total
         FROM credit_card_invoices i JOIN accounts a ON a.id=i.account_id
         WHERE i.deleted_at IS NULL AND strftime('%Y-%m',i.due_date)>=? AND strftime('%Y-%m',i.due_date)<=?
         AND (? IS NULL OR i.account_id=?)"
    ).bind(&filter.start_month).bind(&filter.end_month).bind(&filter.account_id).bind(&filter.account_id)
        .fetch_one(&state.db).await?;
    let invoices=InvoiceReport{open_count:invoice.get("open_count"),paid_count:invoice.get("paid_count"),open_total_in_cents:invoice.get("open_total")};
    let monthly_average=if monthly.is_empty(){0}else{monthly.iter().map(|x|x.expenses_in_cents).sum::<i64>()/monthly.len() as i64};
    let card_share=card.max(0) as f64/total as f64*100.0;
    let mut alerts=vec![];
    if summary.expenses_in_cents>previous_summary.expenses_in_cents&&previous_summary.expenses_in_cents>0 {
        alerts.push(format!("As despesas subiram {:.0}% em relação ao mês anterior.",summary.expense_change_percent.unwrap_or(0.0)));
    }
    if uncategorized_count>0 {alerts.push(format!("{uncategorized_count} transações ainda estão sem categoria."));}
    for goal in &goals {
        if goal.projected_to_exceed {alerts.push(format!("A projeção de {} está fora da meta.",goal.label));}
    }
    Ok(FinancialReport{
        summary,previous_summary,monthly,categories,merchants,daily,sources,goals,invoices,
        uncategorized_count,uncategorized_in_cents:uncategorized.max(0),highest_spending_day,
        monthly_average_in_cents:monthly_average,card_share_percent:card_share,alerts
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn month_helpers_cover_year_boundaries(){
        assert_eq!(shift_month("2026-01",-1).unwrap(),"2025-12");
        assert_eq!(month_range("2025-11","2026-02").unwrap().len(),4);
    }
    #[test] fn percent_change_handles_zero(){assert_eq!(percent_change(10,0),None);}
}

