use chrono::{Datelike, Local, NaiveDate};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::collections::BTreeMap;
use tauri::State;

use crate::{application::state::AppState, error::AppError};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthKindAmount {
    kind: String,
    amount_in_cents: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthPoint {
    month: String,
    total_in_cents: i64,
    assets_in_cents: i64,
    liabilities_in_cents: i64,
    per_kind: Vec<NetWorthKindAmount>,
}

fn checked_i64(value: i128, label: &str) -> Result<i64, AppError> {
    i64::try_from(value).map_err(|_| {
        AppError::Validation(format!(
            "O valor calculado de {label} excede o limite monetário suportado"
        ))
    })
}

#[cfg(test)]
fn aggregate_balances(
    entries: impl IntoIterator<Item = (String, String, i64)>,
) -> Result<(i64, i64, i64, Vec<NetWorthKindAmount>), AppError> {
    let mut account_balances = BTreeMap::<String, (String, i128)>::new();
    for (account_id, kind, amount) in entries {
        let (_, balance) = account_balances
            .entry(account_id)
            .or_insert_with(|| (kind, 0));
        *balance = balance.checked_add(i128::from(amount)).ok_or_else(|| {
            AppError::Validation("O saldo da conta excede o limite monetário suportado".into())
        })?;
    }
    summarize_balances(&account_balances)
}

fn summarize_balances(
    account_balances: &BTreeMap<String, (String, i128)>,
) -> Result<(i64, i64, i64, Vec<NetWorthKindAmount>), AppError> {
    let mut assets = 0i128;
    let mut liabilities = 0i128;
    let mut per_kind = BTreeMap::<String, i128>::new();
    for (kind, balance) in account_balances.values() {
        if *balance >= 0 {
            assets = assets.checked_add(*balance).ok_or_else(|| {
                AppError::Validation("O total de ativos excede o limite monetário suportado".into())
            })?;
        } else {
            liabilities = liabilities.checked_add(*balance).ok_or_else(|| {
                AppError::Validation(
                    "O total de passivos excede o limite monetário suportado".into(),
                )
            })?;
        }
        let kind_balance = per_kind.entry(kind.clone()).or_default();
        *kind_balance = kind_balance.checked_add(*balance).ok_or_else(|| {
            AppError::Validation(
                "O total por tipo de conta excede o limite monetário suportado".into(),
            )
        })?;
    }
    let total = assets.checked_add(liabilities).ok_or_else(|| {
        AppError::Validation("O patrimônio líquido excede o limite monetário suportado".into())
    })?;
    let per_kind = per_kind
        .into_iter()
        .map(|(kind, amount)| {
            Ok(NetWorthKindAmount {
                kind,
                amount_in_cents: checked_i64(amount, "tipo de conta")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok((
        checked_i64(total, "patrimônio líquido")?,
        checked_i64(assets, "ativos")?,
        checked_i64(liabilities, "passivos")?,
        per_kind,
    ))
}

/// Last day (as "YYYY-MM-DD") of a "YYYY-MM" month.
fn month_end_date(month: &str) -> Result<String, AppError> {
    let first = NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Período mensal inválido".into()))?;
    let index = first.year() * 12 + first.month() as i32 - 1 + 1;
    let next_first =
        NaiveDate::from_ymd_opt(index.div_euclid(12), (index.rem_euclid(12) + 1) as u32, 1)
            .ok_or_else(|| AppError::Validation("Período mensal inválido".into()))?;
    Ok(next_first
        .pred_opt()
        .unwrap()
        .format("%Y-%m-%d")
        .to_string())
}

/// Subtracts `count` months from the given "YYYY-MM" month, wrapping across year boundaries.
fn month_minus(month: &str, count: i32) -> Result<String, AppError> {
    let date = NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Período mensal inválido".into()))?;
    let index = date.year() * 12 + date.month() as i32 - 1 - count;
    Ok(format!(
        "{:04}-{:02}",
        index.div_euclid(12),
        index.rem_euclid(12) + 1
    ))
}

/// Returns, for each of the last `months` months (most recent last), the end-of-month total
/// balance (net worth) plus a breakdown per account kind.
///
/// # Data model
/// Accounts have no stored `balance_cents` column — the current balance of an account is always
/// derived as `SUM(transactions.amount_cents)` for that account (see `list_accounts` /
/// `get_app_bootstrap` in `commands/mod.rs`, which follow the same convention). We reuse that
/// convention here for historical points: the end-of-month balance for an account is the sum of
/// every non-deleted transaction on that account dated on or before the last calendar day of that
/// month. Credit card accounts are included the same way — since card purchases post as regular
/// (negative) transactions on the `credit_card` account, a card with more purchases than payments
/// naturally nets to a negative balance, which is exactly the liability we want reflected in the
/// total. No separate handling of `credit_card_invoices` is needed for net worth, since invoices
/// are just a due-date grouping over transactions that are already counted.
#[tauri::command]
pub async fn net_worth_history(
    months: i64,
    state: State<'_, AppState>,
) -> Result<Vec<NetWorthPoint>, AppError> {
    net_worth_history_impl(months, &state.db).await
}

async fn net_worth_history_impl(
    months: i64,
    db: &SqlitePool,
) -> Result<Vec<NetWorthPoint>, AppError> {
    let months = months.clamp(1, 60);
    let current_month = Local::now().format("%Y-%m").to_string();
    let account_rows =
        sqlx::query("SELECT id, kind FROM accounts WHERE deleted_at IS NULL ORDER BY id")
            .fetch_all(db)
            .await?;
    let mut account_balances = account_rows
        .into_iter()
        .map(|row| (row.get("id"), (row.get("kind"), 0i128)))
        .collect::<BTreeMap<String, (String, i128)>>();
    let transaction_rows = sqlx::query(
        "SELECT t.account_id, t.date, t.amount_cents
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
         WHERE t.deleted_at IS NULL
         ORDER BY t.date, t.id",
    )
    .fetch_all(db)
    .await?;
    let transactions = transaction_rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("account_id"),
                row.get::<String, _>("date"),
                row.get::<i64, _>("amount_cents"),
            )
        })
        .collect::<Vec<_>>();
    let mut transaction_index = 0usize;
    let mut points = Vec::with_capacity(months as usize);
    for offset in (0..months).rev() {
        let month = month_minus(&current_month, offset as i32)?;
        let end_date = month_end_date(&month)?;
        while let Some((account_id, date, amount)) = transactions.get(transaction_index) {
            if date > &end_date {
                break;
            }
            if let Some((_, balance)) = account_balances.get_mut(account_id) {
                *balance = balance.checked_add(i128::from(*amount)).ok_or_else(|| {
                    AppError::Validation(
                        "O saldo da conta excede o limite monetário suportado".into(),
                    )
                })?;
            }
            transaction_index += 1;
        }
        let (total_in_cents, assets_in_cents, liabilities_in_cents, per_kind) =
            summarize_balances(&account_balances)?;
        points.push(NetWorthPoint {
            month,
            total_in_cents,
            assets_in_cents,
            liabilities_in_cents,
            per_kind,
        });
    }
    Ok(points)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{complete_onboarding_impl, OnboardingInput};

    async fn setup() -> (tempfile::TempDir, SqlitePool, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("net_worth.db"))
            .await
            .unwrap();
        let onboarding = OnboardingInput {
            display_name: "Pessoa Teste".into(),
            monthly_target_in_cents: None,
            financial_goal: "organize".into(),
            onboarding_start_mode: "manual".into(),
        };
        let account_id = complete_onboarding_impl(onboarding, &db)
            .await
            .unwrap()
            .account_id;
        (directory, db, account_id)
    }

    #[test]
    fn month_minus_wraps_year_boundaries() {
        assert_eq!(month_minus("2026-01", 1).unwrap(), "2025-12");
        assert_eq!(month_minus("2025-12", -1).unwrap(), "2026-01");
    }

    #[test]
    fn month_end_date_handles_february_and_december() {
        assert_eq!(month_end_date("2026-02").unwrap(), "2026-02-28");
        assert_eq!(month_end_date("2024-02").unwrap(), "2024-02-29");
        assert_eq!(month_end_date("2026-12").unwrap(), "2026-12-31");
    }

    #[test]
    fn aggregates_assets_and_liabilities_without_losing_signs() {
        let (total, assets, liabilities, kinds) = aggregate_balances([
            ("checking".into(), "checking".into(), 200_000),
            ("card".into(), "credit_card".into(), -45_000),
            ("card".into(), "credit_card".into(), 5_000),
        ])
        .unwrap();

        assert_eq!(total, 160_000);
        assert_eq!(assets, 200_000);
        assert_eq!(liabilities, -40_000);
        assert_eq!(
            kinds,
            vec![
                NetWorthKindAmount {
                    kind: "checking".into(),
                    amount_in_cents: 200_000,
                },
                NetWorthKindAmount {
                    kind: "credit_card".into(),
                    amount_in_cents: -40_000,
                },
            ]
        );
    }

    #[test]
    fn rejects_totals_that_do_not_fit_the_api_money_type() {
        let error = aggregate_balances([
            ("one".into(), "checking".into(), i64::MAX),
            ("two".into(), "savings".into(), i64::MAX),
        ])
        .unwrap_err();

        assert!(
            matches!(error, AppError::Validation(message) if message.contains("limite monetário"))
        );
    }

    #[tokio::test]
    async fn reconstructs_a_known_past_balance_from_current_balance_and_one_past_transaction() {
        let (_directory, db, account_id) = setup().await;
        let current_month = Local::now().format("%Y-%m").to_string();
        let past_month = month_minus(&current_month, 3).unwrap();
        let past_date = format!("{past_month}-10");

        // One transaction, three months ago: the account's current balance and every historical
        // month-end balance from that point on must equal its amount.
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,status)
             VALUES('tx-1',?,?,'Depósito','DEPOSITO',150000,'fp-1','cleared')"
        ).bind(&account_id).bind(&past_date).execute(&db).await.unwrap();

        let points = net_worth_history_impl(6, &db).await.unwrap();
        assert_eq!(points.len(), 6);
        // The month before the transaction existed must show zero balance.
        let before = points
            .iter()
            .find(|p| p.month == month_minus(&current_month, 4).unwrap())
            .unwrap();
        assert_eq!(before.total_in_cents, 0);
        // From the transaction's month onward, balance is 150000.
        let at = points.iter().find(|p| p.month == past_month).unwrap();
        assert_eq!(at.total_in_cents, 150_000);
        assert_eq!(at.assets_in_cents, 150_000);
        assert_eq!(at.liabilities_in_cents, 0);
        let latest = points.last().unwrap();
        assert_eq!(latest.month, current_month);
        assert_eq!(latest.total_in_cents, 150_000);
        assert_eq!(
            latest.per_kind,
            vec![NetWorthKindAmount {
                kind: "checking".into(),
                amount_in_cents: 150_000
            }]
        );
    }

    #[tokio::test]
    async fn months_out_of_range_are_clamped() {
        let (_directory, db, _account_id) = setup().await;
        let points = net_worth_history_impl(0, &db).await.unwrap();
        assert_eq!(points.len(), 1);
        let points = net_worth_history_impl(1000, &db).await.unwrap();
        assert_eq!(points.len(), 60);
    }
}
