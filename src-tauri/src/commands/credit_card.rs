use chrono::NaiveDate;
use serde::Serialize;
use sqlx::Row;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

use super::{list_matching_profiles, load_rules, validate_mapping_draft};
use crate::{
    application::state::{AppState, CreditCardImportSession},
    domain::{
        categorization::{first_match, CategorizationInput},
        import::{CsvMappingDraft, ImportSourceKind},
        credit_card::{item_fingerprint, CreditCardImportItem},
        import::DuplicateStatus,
    },
    error::AppError,
    infrastructure::importer::{
        detect_import_kind as detect_import_kind_from_file, parse_credit_card_csv, parse_mapped_credit_card_csv,
    },
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardImportPreview {
    session_id: String,
    file_name: String,
    account_id: String,
    due_date: String,
    purchases_in_cents: i64,
    credits_in_cents: i64,
    total_in_cents: i64,
    items: Vec<CreditCardImportItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardInvoice {
    id: String,
    account_id: String,
    account_name: String,
    due_date: String,
    purchases_in_cents: i64,
    credits_in_cents: i64,
    total_in_cents: i64,
    status: String,
    payment_transaction_id: Option<String>,
    payment_description: Option<String>,
    payment_date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardInvoiceItem {
    transaction_id: String,
    date: String,
    description: String,
    amount_in_cents: i64,
    category_id: Option<String>,
    category_name: Option<String>,
    holder: Option<String>,
    installment: Option<String>,
    source_row: i64,
    is_payment: bool,
    is_linked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMatchCandidate {
    transaction_id: String,
    account_name: String,
    date: String,
    description: String,
    amount_in_cents: i64,
    distance_in_days: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionLink {
    id: String,
    debit_transaction_id: String,
    credit_transaction_id: Option<String>,
    invoice_id: Option<String>,
}

fn totals(items: &[CreditCardImportItem]) -> (i64, i64, i64) {
    let purchases = items.iter().filter(|x| x.included && x.raw_amount_in_cents > 0)
        .map(|x| x.raw_amount_in_cents).sum();
    let credits = -items.iter().filter(|x| x.included && x.raw_amount_in_cents < 0)
        .map(|x| x.raw_amount_in_cents).sum::<i64>();
    (purchases, credits, purchases - credits)
}

fn validate_date(value: &str) -> Result<(), AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| AppError::Validation("Vencimento inválido".into()))
}

async fn build_credit_card_preview(
    mut parsed: crate::domain::credit_card::ParsedCreditCardInvoice,
    path: PathBuf,
    account_id: String,
    due_date: Option<String>,
    state: &State<'_, AppState>,
) -> Result<CreditCardImportPreview, AppError> {
    let due_date = due_date.or(parsed.due_date.take())
        .ok_or_else(|| AppError::Validation("Informe o vencimento da fatura".into()))?;
    validate_date(&due_date)?;
    let rules = load_rules(&state.db).await?;
    for item in &mut parsed.items {
        let fp = item_fingerprint(&account_id, item);
        if sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transactions WHERE fingerprint=? AND deleted_at IS NULL"
        ).bind(fp).fetch_one(&state.db).await? > 0 {
            item.candidate.duplicate_status = DuplicateStatus::Exact;
            item.included = false;
        }
        if item.is_payment {
            item.candidate.suggested_category_id = Some("credit-card-payment".into());
            item.candidate.suggested_category_name = Some("Pagamento de fatura".into());
        } else if let Some(rule) = first_match(&rules, &CategorizationInput {
            account_id: &account_id,
            normalized_description: &item.candidate.normalized_description,
            amount_in_cents: item.candidate.amount_in_cents,
        }) {
            item.candidate.suggested_category_id = Some(rule.category_id.clone());
            item.candidate.suggested_category_name = rule.category_name.clone();
            item.candidate.suggested_rule_id = Some(rule.id.clone());
            item.candidate.suggested_rule_name = Some(rule.name.clone());
        }
    }
    let (purchases, credits, total) = totals(&parsed.items);
    let session_id = Uuid::new_v4().to_string();
    let file_name = path.file_name().and_then(|x| x.to_str()).unwrap_or("fatura.csv").to_string();
    state.credit_card_sessions.lock().await.insert(session_id.clone(), CreditCardImportSession {
        account_id: account_id.clone(),
        file_name: file_name.clone(),
        due_date: due_date.clone(),
        items: parsed.items.clone(),
    });
    Ok(CreditCardImportPreview {
        session_id,
        file_name,
        account_id,
        due_date,
        purchases_in_cents: purchases,
        credits_in_cents: credits,
        total_in_cents: total,
        items: parsed.items,
    })
}

#[tauri::command]
pub async fn detect_import_kind(path: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let path = PathBuf::from(path);
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    if extension == "csv" {
        let inspection = crate::infrastructure::importer::inspect_csv_file(&path)?;
        let matched = list_matching_profiles(&state.db, &inspection.headers, &inspection.delimiter).await?;
        if let Some(profile) = matched.first() {
            return Ok(match profile.source_kind {
                ImportSourceKind::Bank => "known_bank",
                ImportSourceKind::CreditCard => "known_credit_card",
            }.into());
        }
    }
    Ok(detect_import_kind_from_file(&path)?.as_str().into())
}

#[tauri::command]
pub async fn create_credit_card_account(name: String, state: State<'_, AppState>) -> Result<String, AppError> {
    if !(2..=80).contains(&name.trim().chars().count()) {
        return Err(AppError::Validation("O nome do cartão deve ter entre 2 e 80 caracteres".into()));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'credit_card')")
        .bind(&id).bind(name.trim()).execute(&state.db).await?;
    Ok(id)
}

#[tauri::command]
pub async fn preview_credit_card_import(
    path: String,
    account_id: String,
    due_date: Option<String>,
    state: State<'_, AppState>,
) -> Result<CreditCardImportPreview, AppError> {
    let account_kind = sqlx::query_scalar::<_, String>(
        "SELECT kind FROM accounts WHERE id=? AND deleted_at IS NULL"
    ).bind(&account_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Validation("Cartão não encontrado".into()))?;
    if account_kind != "credit_card" {
        return Err(AppError::Validation("Selecione uma conta do tipo cartão".into()));
    }
    let path = PathBuf::from(path);
    build_credit_card_preview(parse_credit_card_csv(&path)?, path, account_id, due_date, &state).await
}

#[tauri::command]
pub async fn preview_mapped_credit_card_import(
    path: String,
    account_id: String,
    mapping: CsvMappingDraft,
    state: State<'_, AppState>,
) -> Result<CreditCardImportPreview, AppError> {
    let account_kind = sqlx::query_scalar::<_, String>(
        "SELECT kind FROM accounts WHERE id=? AND deleted_at IS NULL"
    ).bind(&account_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Validation("Cartão não encontrado".into()))?;
    if account_kind != "credit_card" {
        return Err(AppError::Validation("Selecione uma conta do tipo cartão".into()));
    }
    validate_mapping_draft(&mapping)?;
    let path = PathBuf::from(path);
    build_credit_card_preview(parse_mapped_credit_card_csv(&path, &mapping)?, path, account_id, None, &state).await
}

#[tauri::command]
pub async fn update_credit_card_import(
    session_id: String,
    source_row: usize,
    included: bool,
    category_id: Option<String>,
    due_date: Option<String>,
    state: State<'_, AppState>,
) -> Result<CreditCardImportPreview, AppError> {
    if let Some(date) = &due_date { validate_date(date)?; }
    let category_name = if let Some(id) = &category_id {
        Some(sqlx::query_scalar::<_, String>(
            "SELECT name FROM categories WHERE id=? AND deleted_at IS NULL"
        ).bind(id).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?)
    } else { None };
    let mut sessions = state.credit_card_sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or(AppError::SessionExpired)?;
    if let Some(date) = due_date { session.due_date = date; }
    let item = session.items.iter_mut().find(|x| x.candidate.source_row == source_row)
        .ok_or_else(|| AppError::Validation("Item da fatura não encontrado".into()))?;
    if matches!(item.candidate.duplicate_status, DuplicateStatus::Exact) && included {
        return Err(AppError::Validation("Um lançamento duplicado não pode ser incluído".into()));
    }
    item.included = included;
    item.candidate.suggested_category_id = category_id;
    item.candidate.suggested_category_name = category_name;
    item.candidate.suggested_rule_id = None;
    item.candidate.suggested_rule_name = None;
    let (purchases, credits, total) = totals(&session.items);
    Ok(CreditCardImportPreview {
        session_id,
        file_name: session.file_name.clone(),
        account_id: session.account_id.clone(),
        due_date: session.due_date.clone(),
        purchases_in_cents: purchases,
        credits_in_cents: credits,
        total_in_cents: total,
        items: session.items.clone(),
    })
}

#[tauri::command]
pub async fn commit_credit_card_import(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let session = state.credit_card_sessions.lock().await.remove(&session_id)
        .ok_or(AppError::SessionExpired)?;
    let included: Vec<_> = session.items.into_iter().filter(|x| x.included).collect();
    if included.is_empty() {
        return Err(AppError::Validation("Selecione ao menos um item da fatura".into()));
    }
    let (purchases, credits, total) = totals(&included);
    let mut tx = state.db.begin().await?;
    let batch_id = Uuid::new_v4().to_string();
    let invoice_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO import_batches(id,file_name,created_at) VALUES(?,?,datetime('now'))")
        .bind(&batch_id).bind(&session.file_name).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO credit_card_invoices(id,account_id,due_date,purchases_cents,credits_cents,total_cents,status,import_batch_id)
         VALUES(?,?,?,?,?,?,?,?)"
    ).bind(&invoice_id).bind(&session.account_id).bind(&session.due_date)
        .bind(purchases).bind(credits).bind(total).bind(if total <= 0 { "paid" } else { "open" })
        .bind(&batch_id).execute(&mut *tx).await?;
    for item in included {
        let transaction_id = Uuid::new_v4().to_string();
        let source = if item.candidate.suggested_rule_id.is_some() { Some("rule") }
            else if item.candidate.suggested_category_id.is_some() { Some("manual") } else { None };
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,
             category_id,category_source,categorization_rule_id,status,import_batch_id)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(&transaction_id).bind(&session.account_id).bind(&item.candidate.date)
            .bind(&item.candidate.description).bind(&item.candidate.normalized_description)
            .bind(item.candidate.amount_in_cents).bind(item_fingerprint(&session.account_id, &item))
            .bind(&item.candidate.suggested_category_id).bind(source)
            .bind(&item.candidate.suggested_rule_id).bind("cleared").bind(&batch_id)
            .execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO credit_card_invoice_items(invoice_id,transaction_id,holder,installment,source_row,raw_amount_cents)
             VALUES(?,?,?,?,?,?)"
        ).bind(&invoice_id).bind(&transaction_id).bind(&item.holder).bind(&item.installment)
            .bind(item.candidate.source_row as i64).bind(item.raw_amount_in_cents)
            .execute(&mut *tx).await?;
        if let Some(rule_id) = item.candidate.suggested_rule_id {
            sqlx::query("UPDATE categorization_rules SET use_count=use_count+1 WHERE id=?")
                .bind(rule_id).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(invoice_id)
}

#[tauri::command]
pub async fn list_credit_card_invoices(state: State<'_, AppState>) -> Result<Vec<CreditCardInvoice>, AppError> {
    let rows = sqlx::query(
        "SELECT i.id,i.account_id,a.name account_name,i.due_date,i.purchases_cents,i.credits_cents,
         i.total_cents,i.status,i.payment_transaction_id,t.description payment_description,t.date payment_date
         FROM credit_card_invoices i JOIN accounts a ON a.id=i.account_id
         LEFT JOIN transactions t ON t.id=i.payment_transaction_id
         WHERE i.deleted_at IS NULL ORDER BY i.due_date DESC"
    ).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| CreditCardInvoice {
        id:r.get("id"), account_id:r.get("account_id"), account_name:r.get("account_name"),
        due_date:r.get("due_date"), purchases_in_cents:r.get("purchases_cents"),
        credits_in_cents:r.get("credits_cents"), total_in_cents:r.get("total_cents"),
        status:r.get("status"), payment_transaction_id:r.get("payment_transaction_id"),
        payment_description:r.get("payment_description"), payment_date:r.get("payment_date"),
    }).collect())
}

#[tauri::command]
pub async fn get_credit_card_invoice_items(
    invoice_id: String, state: State<'_, AppState>
) -> Result<Vec<CreditCardInvoiceItem>, AppError> {
    let rows = sqlx::query(
        "SELECT t.id transaction_id,t.date,t.description,t.amount_cents,t.category_id,c.name category_name,
         x.holder,x.installment,x.source_row,x.raw_amount_cents,
         EXISTS(SELECT 1 FROM transaction_links l WHERE l.credit_transaction_id=t.id) is_linked
         FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE x.invoice_id=? AND t.deleted_at IS NULL ORDER BY t.date,x.source_row"
    ).bind(invoice_id).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| CreditCardInvoiceItem {
        transaction_id:r.get("transaction_id"), date:r.get("date"), description:r.get("description"),
        amount_in_cents:r.get("amount_cents"), category_id:r.get("category_id"),
        category_name:r.get("category_name"), holder:r.get("holder"), installment:r.get("installment"),
        source_row:r.get("source_row"), is_payment:r.get::<i64,_>("raw_amount_cents") < 0,
        is_linked:r.get::<i64,_>("is_linked") != 0,
    }).collect())
}

#[tauri::command]
pub async fn find_invoice_payment_matches(
    invoice_id: String, state: State<'_, AppState>
) -> Result<Vec<PaymentMatchCandidate>, AppError> {
    let invoice = sqlx::query("SELECT due_date,total_cents,payment_transaction_id FROM credit_card_invoices WHERE id=? AND deleted_at IS NULL")
        .bind(&invoice_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Validation("Fatura não encontrada".into()))?;
    if invoice.get::<Option<String>,_>("payment_transaction_id").is_some() {
        return Ok(vec![]);
    }
    let due_date: String = invoice.get("due_date");
    let total: i64 = invoice.get("total_cents");
    let rows = sqlx::query(
        "SELECT t.id,a.name account_name,t.date,t.description,t.amount_cents,
         CAST(ABS(julianday(t.date)-julianday(?)) AS INTEGER) distance
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE a.kind!='credit_card' AND t.deleted_at IS NULL AND t.amount_cents=?
         AND ABS(julianday(t.date)-julianday(?))<=10
         AND NOT EXISTS(SELECT 1 FROM transaction_links l WHERE l.debit_transaction_id=t.id)
         ORDER BY distance,t.date"
    ).bind(&due_date).bind(-total.abs()).bind(&due_date).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| PaymentMatchCandidate {
        transaction_id:r.get("id"), account_name:r.get("account_name"), date:r.get("date"),
        description:r.get("description"), amount_in_cents:r.get("amount_cents"),
        distance_in_days:r.get("distance"),
    }).collect())
}

#[tauri::command]
pub async fn link_invoice_payment(
    invoice_id: String,
    bank_transaction_id: String,
    state: State<'_, AppState>,
) -> Result<TransactionLink, AppError> {
    let mut tx = state.db.begin().await?;
    let invoice = sqlx::query("SELECT total_cents,payment_transaction_id FROM credit_card_invoices WHERE id=? AND deleted_at IS NULL")
        .bind(&invoice_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Fatura não encontrada".into()))?;
    if invoice.get::<Option<String>,_>("payment_transaction_id").is_some() {
        return Err(AppError::Validation("Esta fatura já possui um pagamento".into()));
    }
    let bank = sqlx::query(
        "SELECT t.amount_cents,t.category_id,t.category_source,t.categorization_rule_id
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind!='credit_card'"
    ).bind(&bank_transaction_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Pagamento bancário não encontrado".into()))?;
    if bank.get::<i64,_>("amount_cents") != -invoice.get::<i64,_>("total_cents").abs() {
        return Err(AppError::Validation("O pagamento precisa ter o mesmo valor da fatura".into()));
    }
    let link_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO transaction_links(id,kind,debit_transaction_id,invoice_id,previous_category_id,previous_category_source,previous_rule_id)
         VALUES(?,'credit_card_payment',?,?,?,?,?)"
    ).bind(&link_id).bind(&bank_transaction_id).bind(&invoice_id)
        .bind(bank.get::<Option<String>,_>("category_id"))
        .bind(bank.get::<Option<String>,_>("category_source"))
        .bind(bank.get::<Option<String>,_>("categorization_rule_id"))
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE credit_card_invoices SET payment_transaction_id=?,status='paid' WHERE id=?")
        .bind(&bank_transaction_id).bind(&invoice_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE transactions SET category_id='credit-card-payment',category_source='manual',categorization_rule_id=NULL WHERE id=?")
        .bind(&bank_transaction_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(TransactionLink { id:link_id, debit_transaction_id:bank_transaction_id, credit_transaction_id:None, invoice_id:Some(invoice_id) })
}

#[tauri::command]
pub async fn unlink_invoice_payment(invoice_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let link = sqlx::query(
        "SELECT debit_transaction_id,previous_category_id,previous_category_source,previous_rule_id
         FROM transaction_links WHERE invoice_id=?"
    ).bind(&invoice_id).fetch_optional(&mut *tx).await?;
    sqlx::query("DELETE FROM transaction_links WHERE invoice_id=?").bind(&invoice_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE credit_card_invoices SET payment_transaction_id=NULL,status=CASE WHEN total_cents<=0 THEN 'paid' ELSE 'open' END WHERE id=?")
        .bind(&invoice_id).execute(&mut *tx).await?;
    if let Some(link) = link {
        sqlx::query("UPDATE transactions SET category_id=?,category_source=?,categorization_rule_id=? WHERE id=?")
            .bind(link.get::<Option<String>,_>("previous_category_id"))
            .bind(link.get::<Option<String>,_>("previous_category_source"))
            .bind(link.get::<Option<String>,_>("previous_rule_id"))
            .bind(link.get::<String,_>("debit_transaction_id")).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn set_invoice_status(invoice_id: String, status: String, state: State<'_, AppState>) -> Result<(), AppError> {
    if status != "paid" && status != "open" { return Err(AppError::Validation("Status inválido".into())); }
    sqlx::query("UPDATE credit_card_invoices SET status=? WHERE id=?")
        .bind(status).bind(invoice_id).execute(&state.db).await?;
    Ok(())
}

#[tauri::command]
pub async fn find_card_payment_matches(
    credit_transaction_id: String, state: State<'_, AppState>
) -> Result<Vec<PaymentMatchCandidate>, AppError> {
    let payment = sqlx::query(
        "SELECT t.date,t.amount_cents FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind='credit_card' AND t.amount_cents>0"
    ).bind(&credit_transaction_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Validation("Crédito de pagamento não encontrado".into()))?;
    let date: String = payment.get("date");
    let amount: i64 = payment.get("amount_cents");
    let rows = sqlx::query(
        "SELECT t.id,a.name account_name,t.date,t.description,t.amount_cents,
         CAST(ABS(julianday(t.date)-julianday(?)) AS INTEGER) distance
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE a.kind!='credit_card' AND t.deleted_at IS NULL AND t.amount_cents=?
         AND ABS(julianday(t.date)-julianday(?))<=10
         AND NOT EXISTS(SELECT 1 FROM transaction_links l WHERE l.debit_transaction_id=t.id)
         ORDER BY distance,t.date"
    ).bind(&date).bind(-amount).bind(&date).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|r| PaymentMatchCandidate {
        transaction_id:r.get("id"), account_name:r.get("account_name"), date:r.get("date"),
        description:r.get("description"), amount_in_cents:r.get("amount_cents"),
        distance_in_days:r.get("distance"),
    }).collect())
}

#[tauri::command]
pub async fn link_card_payment(
    credit_transaction_id: String,
    bank_transaction_id: String,
    state: State<'_, AppState>,
) -> Result<TransactionLink, AppError> {
    let mut tx = state.db.begin().await?;
    let credit = sqlx::query_scalar::<_,i64>(
        "SELECT t.amount_cents FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind='credit_card' AND t.amount_cents>0"
    ).bind(&credit_transaction_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Crédito de pagamento não encontrado".into()))?;
    let bank = sqlx::query(
        "SELECT t.amount_cents,t.category_id,t.category_source,t.categorization_rule_id
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind!='credit_card'"
    ).bind(&bank_transaction_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Débito bancário não encontrado".into()))?;
    if bank.get::<i64,_>("amount_cents") != -credit {
        return Err(AppError::Validation("Os dois lados do pagamento precisam ter o mesmo valor".into()));
    }
    let id=Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO transaction_links(id,kind,debit_transaction_id,credit_transaction_id,previous_category_id,previous_category_source,previous_rule_id)
         VALUES(?,'credit_card_payment',?,?,?,?,?)"
    ).bind(&id).bind(&bank_transaction_id).bind(&credit_transaction_id)
        .bind(bank.get::<Option<String>,_>("category_id"))
        .bind(bank.get::<Option<String>,_>("category_source"))
        .bind(bank.get::<Option<String>,_>("categorization_rule_id"))
        .execute(&mut *tx).await?;
    for transaction_id in [&bank_transaction_id,&credit_transaction_id] {
        sqlx::query("UPDATE transactions SET category_id='credit-card-payment',category_source='manual',categorization_rule_id=NULL WHERE id=?")
            .bind(transaction_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(TransactionLink { id, debit_transaction_id:bank_transaction_id, credit_transaction_id:Some(credit_transaction_id), invoice_id:None })
}

#[tauri::command]
pub async fn unlink_card_payment(
    credit_transaction_id: String, state: State<'_, AppState>
) -> Result<(), AppError> {
    let mut tx=state.db.begin().await?;
    let link=sqlx::query(
        "SELECT debit_transaction_id,previous_category_id,previous_category_source,previous_rule_id
         FROM transaction_links WHERE credit_transaction_id=?"
    ).bind(&credit_transaction_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Conciliação não encontrada".into()))?;
    sqlx::query("DELETE FROM transaction_links WHERE credit_transaction_id=?")
        .bind(&credit_transaction_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE transactions SET category_id=?,category_source=?,categorization_rule_id=? WHERE id=?")
        .bind(link.get::<Option<String>,_>("previous_category_id"))
        .bind(link.get::<Option<String>,_>("previous_category_source"))
        .bind(link.get::<Option<String>,_>("previous_rule_id"))
        .bind(link.get::<String,_>("debit_transaction_id")).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn set_credit_card_invoice_deleted(
    invoice_id: String, deleted: bool, state: State<'_, AppState>
) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let batch_id = sqlx::query_scalar::<_,String>("SELECT import_batch_id FROM credit_card_invoices WHERE id=?")
        .bind(&invoice_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Fatura não encontrada".into()))?;
    if deleted {
        let linked: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transaction_links l
             WHERE l.invoice_id=? OR l.credit_transaction_id IN (
               SELECT transaction_id FROM credit_card_invoice_items WHERE invoice_id=?
             )"
        ).bind(&invoice_id).bind(&invoice_id).fetch_one(&mut *tx).await?;
        if linked > 0 {
            return Err(AppError::Validation(
                "Desvincule os pagamentos conciliados antes de excluir a fatura".into()
            ));
        }
        sqlx::query("UPDATE credit_card_invoices SET deleted_at=datetime('now'),payment_transaction_id=NULL WHERE id=?")
            .bind(&invoice_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE transactions SET deleted_at=datetime('now') WHERE import_batch_id=?")
            .bind(&batch_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE import_batches SET undone_at=datetime('now') WHERE id=?")
            .bind(&batch_id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE credit_card_invoices SET deleted_at=NULL WHERE id=?").bind(&invoice_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE transactions SET deleted_at=NULL WHERE import_batch_id=?").bind(&batch_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE import_batches SET undone_at=NULL WHERE id=?").bind(&batch_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}
