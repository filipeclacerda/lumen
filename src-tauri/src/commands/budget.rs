use chrono::Local;
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet};
use tauri::State;

use super::reports::{
    category_scope_ids, days_in_month, effective_days, expense_value, load_category_children,
    load_report_rows_for_month, load_targets, parse_month,
};
use crate::{application::state::AppState, error::AppError};

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetCategory {
    target_id: String,
    category_id: String,
    category_name: String,
    category_color: Option<String>,
    include_descendants: bool,
    limit_in_cents: i64,
    spent_in_cents: i64,
    remaining_in_cents: i64,
    progress_percent: f64,
    projected_in_cents: i64,
    status: String,
}

#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetTotals {
    limit_in_cents: i64,
    spent_in_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetOverview {
    categories: Vec<BudgetCategory>,
    totals: BudgetTotals,
}

/// Budget status thresholds: 100%+ spent is "over", 80%+ is "warning", otherwise "ok".
fn status_for(progress_percent: f64) -> &'static str {
    if progress_percent > 100.0 {
        "over"
    } else if progress_percent >= 80.0 {
        "warning"
    } else {
        "ok"
    }
}

fn budget_overflow() -> AppError {
    AppError::Validation("O orçamento excedeu o limite numérico".into())
}

fn budget_i64(value: i128) -> Result<i64, AppError> {
    i64::try_from(value).map_err(|_| budget_overflow())
}

/// Reads a category's monthly budget (an enabled `financial_targets` row of kind='category')
/// against that month's actual spend, using the exact same income/expense classification as
/// the financial report (`expense_value`) so the budget page and the reports page never
/// disagree. When `month` is the current month, `projected_in_cents` pro-rates the elapsed
/// spend to a full-month estimate; otherwise it simply echoes the final spend.
#[tauri::command]
pub async fn budget_overview(
    month: String,
    state: State<'_, AppState>,
) -> Result<BudgetOverview, AppError> {
    budget_overview_impl(month, &state.db).await
}

async fn budget_overview_impl(month: String, db: &SqlitePool) -> Result<BudgetOverview, AppError> {
    parse_month(&month)?;

    let rows = load_report_rows_for_month(db, &month, "all").await?;
    let mut spent_by_category: HashMap<String, i64> = HashMap::new();
    for row in &rows {
        let expense = expense_value(row);
        if expense == 0 {
            continue;
        }
        if let Some(category_id) = &row.category_id {
            let current = spent_by_category.entry(category_id.clone()).or_default();
            *current = current.checked_add(expense).ok_or_else(budget_overflow)?;
        }
    }

    let category_colors: HashMap<String, Option<String>> =
        sqlx::query("SELECT id, color FROM categories WHERE deleted_at IS NULL")
            .fetch_all(db)
            .await?
            .into_iter()
            .map(|r| (r.get("id"), r.get("color")))
            .collect();

    let is_current_month = month == Local::now().date_naive().format("%Y-%m").to_string();
    let elapsed = effective_days(&month).max(1);
    let total_days = days_in_month(&month);

    let targets = load_targets(db).await?;
    let category_children = load_category_children(db).await?;
    let mut categories = vec![];
    let mut totals = BudgetTotals::default();
    let mut covered_category_ids = HashSet::new();
    let mut total_spent = 0i128;
    for target in targets
        .into_iter()
        .filter(|t| t.enabled && t.kind == "category")
    {
        let category_id = match target.category_id {
            Some(id) => id,
            None => continue,
        };
        let limit_in_cents = target
            .overrides
            .iter()
            .find(|o| o.month == month)
            .map(|o| o.amount_in_cents)
            .unwrap_or(target.amount_in_cents);
        let scope =
            category_scope_ids(&category_id, target.include_descendants, &category_children);
        let spent_in_cents = budget_i64(scope.iter().try_fold(0i128, |total, id| {
            total
                .checked_add(i128::from(spent_by_category.get(id).copied().unwrap_or(0)))
                .ok_or_else(budget_overflow)
        })?)?
        .max(0);
        let remaining_in_cents =
            budget_i64(i128::from(limit_in_cents) - i128::from(spent_in_cents))?;
        let progress_percent = if limit_in_cents > 0 {
            spent_in_cents as f64 / limit_in_cents as f64 * 100.0
        } else {
            0.0
        };
        let projected_in_cents = if is_current_month {
            budget_i64((i128::from(spent_in_cents) * i128::from(total_days)) / i128::from(elapsed))?
        } else {
            spent_in_cents
        };
        totals.limit_in_cents =
            budget_i64(i128::from(totals.limit_in_cents) + i128::from(limit_in_cents))?;
        for covered_id in &scope {
            if covered_category_ids.insert(covered_id.clone()) {
                total_spent = total_spent
                    .checked_add(i128::from(
                        spent_by_category.get(covered_id).copied().unwrap_or(0),
                    ))
                    .ok_or_else(budget_overflow)?;
            }
        }
        categories.push(BudgetCategory {
            target_id: target.id,
            category_name: target.category_name.unwrap_or_else(|| "Categoria".into()),
            category_color: category_colors.get(&category_id).cloned().flatten(),
            include_descendants: target.include_descendants,
            category_id,
            limit_in_cents,
            spent_in_cents,
            remaining_in_cents,
            progress_percent,
            projected_in_cents,
            status: status_for(progress_percent).into(),
        });
    }
    totals.spent_in_cents = budget_i64(total_spent)?.max(0);
    categories.sort_by(|a, b| b.progress_percent.partial_cmp(&a.progress_percent).unwrap());

    Ok(BudgetOverview { categories, totals })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("budget.db"))
            .await
            .unwrap();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('acc','Conta','checking')")
            .execute(&db)
            .await
            .unwrap();
        (directory, db)
    }

    async fn insert_category(db: &SqlitePool, id: &str, name: &str, color: &str) {
        sqlx::query("INSERT INTO categories(id,name,kind,color) VALUES(?,?,'expense',?)")
            .bind(id)
            .bind(name)
            .bind(color)
            .execute(db)
            .await
            .unwrap();
    }

    async fn insert_child_category(db: &SqlitePool, id: &str, parent_id: &str, name: &str) {
        sqlx::query("INSERT INTO categories(id,parent_id,name,kind) VALUES(?,?,?,'expense')")
            .bind(id)
            .bind(parent_id)
            .bind(name)
            .execute(db)
            .await
            .unwrap();
    }

    async fn insert_target(db: &SqlitePool, id: &str, category_id: &str, amount_cents: i64) {
        sqlx::query(
            "INSERT INTO financial_targets(id,kind,category_id,amount_cents,enabled) VALUES(?,'category',?,?,1)",
        )
        .bind(id)
        .bind(category_id)
        .bind(amount_cents)
        .execute(db)
        .await
        .unwrap();
    }

    async fn insert_expense(
        db: &SqlitePool,
        id: &str,
        date: &str,
        category_id: &str,
        amount_cents: i64,
    ) {
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,fingerprint,category_id,status)
             VALUES(?,'acc',?,'Despesa','despesa','despesa',?,?,?,'cleared')"
        ).bind(id).bind(date).bind(amount_cents).bind(format!("fp-{id}")).bind(category_id)
            .execute(db).await.unwrap();
    }

    #[tokio::test]
    async fn computes_spent_status_and_month_override() {
        let (_directory, db) = setup().await;
        insert_category(&db, "budget-food", "Alimentação", "#e5a142").await;
        insert_category(&db, "budget-leisure", "Lazer", "#4c94a8").await;
        insert_target(&db, "goal-food", "budget-food", 50000).await;
        insert_target(&db, "goal-leisure", "budget-leisure", 10000).await;
        // Month override halves the leisure budget for June.
        sqlx::query("INSERT INTO financial_target_overrides(id,target_id,month,amount_cents) VALUES('ov1','goal-leisure','2026-06',5000)")
            .execute(&db).await.unwrap();

        // Food: 40000 spent of 50000 -> 80% -> warning.
        insert_expense(&db, "e1", "2026-06-05", "budget-food", -25000).await;
        insert_expense(&db, "e2", "2026-06-06", "budget-food", -15000).await;
        // Leisure: 6000 spent of the 5000 override -> over budget.
        insert_expense(&db, "e3", "2026-06-07", "budget-leisure", -6000).await;

        let overview = budget_overview_impl("2026-06".into(), &db).await.unwrap();
        assert_eq!(overview.categories.len(), 2);

        let food = overview
            .categories
            .iter()
            .find(|c| c.category_id == "budget-food")
            .unwrap();
        assert_eq!(food.limit_in_cents, 50000);
        assert_eq!(food.spent_in_cents, 40000);
        assert_eq!(food.remaining_in_cents, 10000);
        assert_eq!(food.status, "warning");
        assert_eq!(food.category_color.as_deref(), Some("#e5a142"));

        let leisure = overview
            .categories
            .iter()
            .find(|c| c.category_id == "budget-leisure")
            .unwrap();
        assert_eq!(
            leisure.limit_in_cents, 5000,
            "month override must win over base amount"
        );
        assert_eq!(leisure.spent_in_cents, 6000);
        assert_eq!(leisure.remaining_in_cents, -1000);
        assert_eq!(leisure.status, "over");

        assert_eq!(overview.totals.limit_in_cents, 55000);
        assert_eq!(overview.totals.spent_in_cents, 46000);
    }

    #[tokio::test]
    async fn projects_pro_rata_for_the_current_month() {
        let (_directory, db) = setup().await;
        let today = Local::now().date_naive();
        let current_month = today.format("%Y-%m").to_string();
        insert_category(&db, "budget-food", "Alimentação", "#e5a142").await;
        insert_target(&db, "goal-food", "budget-food", 100000).await;
        insert_expense(
            &db,
            "e1",
            &format!("{current_month}-01"),
            "budget-food",
            -20000,
        )
        .await;

        let overview = budget_overview_impl(current_month.clone(), &db)
            .await
            .unwrap();
        let food = &overview.categories[0];
        let elapsed = effective_days(&current_month).max(1);
        let total_days = days_in_month(&current_month);
        if elapsed < total_days {
            assert!(
                food.projected_in_cents > food.spent_in_cents,
                "projected {} should exceed partial spend {} mid-month",
                food.projected_in_cents,
                food.spent_in_cents
            );
        } else {
            assert_eq!(food.projected_in_cents, food.spent_in_cents);
        }
    }

    #[tokio::test]
    async fn ignores_disabled_and_savings_targets() {
        let (_directory, db) = setup().await;
        insert_category(&db, "budget-food", "Alimentação", "#e5a142").await;
        sqlx::query("INSERT INTO financial_targets(id,kind,category_id,amount_cents,enabled) VALUES('goal-disabled','category','budget-food',50000,0)")
            .execute(&db).await.unwrap();
        sqlx::query("INSERT INTO financial_targets(id,kind,category_id,amount_cents,enabled) VALUES('goal-savings','savings',NULL,100000,1)")
            .execute(&db).await.unwrap();

        let overview = budget_overview_impl("2026-06".into(), &db).await.unwrap();
        assert!(overview.categories.is_empty());
        assert_eq!(overview.totals, BudgetTotals::default());
    }

    #[tokio::test]
    async fn includes_all_descendants_once_when_requested() {
        let (_directory, db) = setup().await;
        insert_category(&db, "budget-family", "Casa", "#728bba").await;
        insert_child_category(&db, "budget-utilities", "budget-family", "Contas").await;
        insert_child_category(&db, "budget-electricity", "budget-utilities", "Energia").await;
        insert_target(&db, "goal-home", "budget-family", 100_000).await;
        sqlx::query("UPDATE financial_targets SET include_descendants=1 WHERE id='goal-home'")
            .execute(&db)
            .await
            .unwrap();
        insert_expense(&db, "e-parent", "2026-06-01", "budget-family", -10_000).await;
        insert_expense(&db, "e-child", "2026-06-02", "budget-utilities", -20_000).await;
        insert_expense(
            &db,
            "e-grandchild",
            "2026-06-03",
            "budget-electricity",
            -30_000,
        )
        .await;

        let overview = budget_overview_impl("2026-06".into(), &db).await.unwrap();

        assert_eq!(overview.categories[0].spent_in_cents, 60_000);
        assert!(overview.categories[0].include_descendants);
        assert_eq!(overview.totals.spent_in_cents, 60_000);
    }

    #[tokio::test]
    async fn defaults_to_only_the_selected_category_and_deduplicates_overlapping_totals() {
        let (_directory, db) = setup().await;
        insert_category(&db, "budget-family", "Casa", "#728bba").await;
        insert_child_category(&db, "budget-utilities", "budget-family", "Contas").await;
        insert_target(&db, "goal-home", "budget-family", 100_000).await;
        insert_target(&db, "goal-utilities", "budget-utilities", 40_000).await;
        insert_expense(&db, "e-parent", "2026-06-01", "budget-family", -10_000).await;
        insert_expense(&db, "e-child", "2026-06-02", "budget-utilities", -20_000).await;

        let default_overview = budget_overview_impl("2026-06".into(), &db).await.unwrap();
        let home = default_overview
            .categories
            .iter()
            .find(|category| category.category_id == "budget-family")
            .unwrap();
        assert_eq!(home.spent_in_cents, 10_000);
        assert!(!home.include_descendants);

        sqlx::query("UPDATE financial_targets SET include_descendants=1 WHERE id='goal-home'")
            .execute(&db)
            .await
            .unwrap();
        let overlapping_overview = budget_overview_impl("2026-06".into(), &db).await.unwrap();
        let home = overlapping_overview
            .categories
            .iter()
            .find(|category| category.category_id == "budget-family")
            .unwrap();
        assert_eq!(home.spent_in_cents, 30_000);
        assert_eq!(
            overlapping_overview.totals.spent_in_cents, 30_000,
            "a subcategoria coberta por dois limites não pode ser somada duas vezes no total"
        );
    }
}
