use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use super::{ensure_account_active, ensure_transaction_category_compatible, manual_fingerprint};
use crate::{
    application::state::AppState, domain::import::normalize_description,
    domain::merchant::merchant_key, error::AppError,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallmentPlanInput {
    account_id: String,
    first_date: String,
    description: String,
    total_amount_in_cents: i64,
    installment_count: i64,
    category_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallmentPlanResult {
    plan_id: String,
    transaction_ids: Vec<String>,
}

fn split_installments(total_cents: i64, count: i64) -> Result<Vec<i64>, AppError> {
    if total_cents <= 0 {
        return Err(AppError::Validation(
            "O valor total deve ser maior que zero".into(),
        ));
    }
    if !(2..=48).contains(&count) {
        return Err(AppError::Validation("Escolha entre 2 e 48 parcelas".into()));
    }
    if total_cents < count {
        return Err(AppError::Validation(
            "O valor total precisa permitir ao menos um centavo por parcela".into(),
        ));
    }
    let base = total_cents / count;
    let remainder = total_cents % count;
    Ok((0..count)
        .map(|index| base + i64::from(index < remainder))
        .collect())
}

fn days_in_month(year: i32, month: u32) -> Option<u32> {
    let (next_year, next_month) = if month == 12 {
        (year.checked_add(1)?, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .and_then(|date| date.pred_opt())
        .map(|date| date.day())
}

fn installment_date(first_date: NaiveDate, offset: i64) -> Result<NaiveDate, AppError> {
    let absolute_month = i64::from(first_date.year())
        .checked_mul(12)
        .and_then(|value| value.checked_add(i64::from(first_date.month0())))
        .and_then(|value| value.checked_add(offset))
        .ok_or_else(|| AppError::Validation("Data das parcelas fora do intervalo aceito".into()))?;
    let year = i32::try_from(absolute_month.div_euclid(12))
        .map_err(|_| AppError::Validation("Data das parcelas fora do intervalo aceito".into()))?;
    let month = u32::try_from(absolute_month.rem_euclid(12) + 1)
        .map_err(|_| AppError::Validation("Data das parcelas fora do intervalo aceito".into()))?;
    let day = first_date
        .day()
        .min(days_in_month(year, month).ok_or_else(|| {
            AppError::Validation("Data das parcelas fora do intervalo aceito".into())
        })?);
    NaiveDate::from_ymd_opt(year, month, day)
        .ok_or_else(|| AppError::Validation("Data das parcelas fora do intervalo aceito".into()))
}

#[tauri::command]
pub async fn create_credit_card_installments(
    input: InstallmentPlanInput,
    state: State<'_, AppState>,
) -> Result<InstallmentPlanResult, AppError> {
    create_credit_card_installments_impl(input, &state.db).await
}

async fn create_credit_card_installments_impl(
    input: InstallmentPlanInput,
    db: &SqlitePool,
) -> Result<InstallmentPlanResult, AppError> {
    let description = input.description.trim().to_string();
    if !(1..=190).contains(&description.chars().count()) {
        return Err(AppError::Validation(
            "A descrição deve ter entre 1 e 190 caracteres".into(),
        ));
    }
    let first_date = NaiveDate::parse_from_str(input.first_date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Data inválida".into()))?;
    let amounts = split_installments(input.total_amount_in_cents, input.installment_count)?;
    ensure_account_active(db, &input.account_id).await?;
    let account_kind = sqlx::query_scalar::<_, String>(
        "SELECT kind FROM accounts WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&input.account_id)
    .fetch_one(db)
    .await?;
    if account_kind != "credit_card" {
        return Err(AppError::Validation(
            "Parcelamento manual só pode ser lançado em cartão de crédito".into(),
        ));
    }
    ensure_transaction_category_compatible(
        db,
        &input.category_id,
        &input.account_id,
        -input.total_amount_in_cents,
    )
    .await?;

    let plan_id = Uuid::new_v4().to_string();
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO installment_plans(
           id,account_id,first_date,description,total_cents,installment_count,category_id
         ) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(&plan_id)
    .bind(&input.account_id)
    .bind(first_date.format("%Y-%m-%d").to_string())
    .bind(&description)
    .bind(input.total_amount_in_cents)
    .bind(input.installment_count)
    .bind(&input.category_id)
    .execute(&mut *tx)
    .await?;

    let mut transaction_ids = Vec::with_capacity(amounts.len());
    for (index, amount) in amounts.into_iter().enumerate() {
        let number = i64::try_from(index + 1)
            .map_err(|_| AppError::Validation("Quantidade de parcelas inválida".into()))?;
        let date = installment_date(first_date, number - 1)?
            .format("%Y-%m-%d")
            .to_string();
        let installment_description =
            format!("{description} ({number}/{})", input.installment_count);
        let normalized = normalize_description(&installment_description);
        let merchant = merchant_key(&normalized);
        let signed_amount = -amount;
        let fingerprint = manual_fingerprint(
            &input.account_id,
            &date,
            &installment_description,
            &normalized,
            signed_amount,
        );
        let collides = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND deleted_at IS NULL",
        )
        .bind(&fingerprint)
        .fetch_one(&mut *tx)
        .await?
            > 0;
        if collides {
            return Err(AppError::Validation(
                "Já existe um parcelamento idêntico neste cartão".into(),
            ));
        }

        let transaction_id = Uuid::new_v4().to_string();
        let category_source = input.category_id.as_ref().map(|_| "manual");
        sqlx::query(
            "INSERT INTO transactions(
               id,account_id,date,description,normalized_description,merchant_key,amount_cents,
               fingerprint,category_id,category_source,status
             ) VALUES(?,?,?,?,?,?,?,?,?,?,'cleared')",
        )
        .bind(&transaction_id)
        .bind(&input.account_id)
        .bind(&date)
        .bind(&installment_description)
        .bind(&normalized)
        .bind(&merchant)
        .bind(signed_amount)
        .bind(&fingerprint)
        .bind(&input.category_id)
        .bind(category_source)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO transaction_installments(
               plan_id,transaction_id,installment_number,installment_count
             ) VALUES(?,?,?,?)",
        )
        .bind(&plan_id)
        .bind(&transaction_id)
        .bind(number)
        .bind(input.installment_count)
        .execute(&mut *tx)
        .await?;
        transaction_ids.push(transaction_id);
    }
    tx.commit().await?;
    Ok(InstallmentPlanResult {
        plan_id,
        transaction_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    async fn test_database(name: &str) -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join(name))
            .await
            .unwrap();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES('card','Cartão','credit_card')")
            .execute(&db)
            .await
            .unwrap();
        (directory, db)
    }

    fn input() -> InstallmentPlanInput {
        InstallmentPlanInput {
            account_id: "card".into(),
            first_date: "2026-01-31".into(),
            description: "Compra teste".into(),
            total_amount_in_cents: 10_000,
            installment_count: 3,
            category_id: None,
        }
    }

    #[test]
    fn splits_one_hundred_reais_without_losing_a_cent() {
        let parts = split_installments(10_000, 3).unwrap();
        assert_eq!(parts, vec![3_334, 3_333, 3_333]);
        assert_eq!(parts.iter().sum::<i64>(), 10_000);
    }

    #[test]
    fn clamps_day_31_and_crosses_the_year() {
        let january = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        assert_eq!(
            installment_date(january, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
        );
        assert_eq!(
            installment_date(january, 2).unwrap(),
            NaiveDate::from_ymd_opt(2026, 3, 31).unwrap()
        );
        let december = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
        assert_eq!(
            installment_date(december, 1).unwrap(),
            NaiveDate::from_ymd_opt(2027, 1, 31).unwrap()
        );
    }

    #[tokio::test]
    async fn creates_all_installments_and_metadata_atomically() {
        let (_directory, db) = test_database("installments.db").await;
        let result = create_credit_card_installments_impl(input(), &db)
            .await
            .unwrap();
        assert_eq!(result.transaction_ids.len(), 3);
        let rows = sqlx::query(
            "SELECT t.date,t.amount_cents,x.installment_number,x.installment_count
             FROM transactions t
             JOIN transaction_installments x ON x.transaction_id=t.id
             WHERE x.plan_id=? ORDER BY x.installment_number",
        )
        .bind(result.plan_id)
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].get::<String, _>("date"), "2026-01-31");
        assert_eq!(rows[1].get::<String, _>("date"), "2026-02-28");
        assert_eq!(rows[2].get::<String, _>("date"), "2026-03-31");
        assert_eq!(rows[0].get::<i64, _>("amount_cents"), -3_334);
        assert_eq!(
            rows.iter()
                .map(|row| row.get::<i64, _>("amount_cents"))
                .sum::<i64>(),
            -10_000
        );
    }

    #[tokio::test]
    async fn duplicate_rolls_back_the_entire_second_plan() {
        let (_directory, db) = test_database("duplicate-installments.db").await;
        create_credit_card_installments_impl(input(), &db)
            .await
            .unwrap();
        let duplicate = create_credit_card_installments_impl(input(), &db).await;
        assert!(matches!(duplicate, Err(AppError::Validation(_))));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions")
                .fetch_one(&db)
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM installment_plans")
                .fetch_one(&db)
                .await
                .unwrap(),
            1
        );
    }
}
