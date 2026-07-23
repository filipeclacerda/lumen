use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::{collections::HashSet, path::PathBuf};
use tauri::State;
use uuid::Uuid;

use super::{apply_category_suggestions_to, load_rules, validate_mapping_draft};
use crate::{
    application::state::{AppState, CreditCardImportSession},
    domain::{
        credit_card::{item_fingerprint, mark_intra_file_duplicates, totals, CreditCardImportItem},
        import::CsvMappingDraft,
        import::{DuplicateStatus, SuggestionSource},
        merchant::merchant_key,
        suggestion::{category_compatible, SuggestionContext},
    },
    error::AppError,
    infrastructure::importer::{
        detect_import_kind as detect_import_kind_from_file, parse_credit_card_csv,
        parse_mapped_credit_card_csv,
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardInvoicePageFilter {
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardInvoicePage {
    items: Vec<CreditCardInvoice>,
    total_count: i64,
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
    line_kind: String,
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
    let due_date = due_date
        .or(parsed.due_date.take())
        .ok_or_else(|| AppError::Validation("Informe o vencimento da fatura".into()))?;
    validate_date(&due_date)?;
    let rules = load_rules(&state.db).await?;
    let mut seen_external = HashSet::new();
    let mut seen_fingerprint = HashSet::new();
    for item in &mut parsed.items {
        item.candidate.merchant_key = merchant_key(&item.candidate.normalized_description);
        item.candidate.category_suggestions.clear();
        if let Some(id) = item.candidate.external_id.as_mut() {
            *id = id.trim().to_string();
            if id.is_empty() {
                item.candidate.external_id = None;
            }
        }
        let fp = item_fingerprint(&account_id, item);
        let duplicate = if let Some(id) = item.candidate.external_id.as_deref() {
            !seen_external.insert(id.to_string()) || sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM transactions WHERE account_id=? AND external_id=? AND deleted_at IS NULL",
            ).bind(&account_id).bind(id).fetch_one(&state.db).await? > 0
        } else {
            !seen_fingerprint.insert(fp.clone()) || sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM transactions WHERE account_id=? AND fingerprint=? AND deleted_at IS NULL",
            ).bind(&account_id).bind(fp).fetch_one(&state.db).await? > 0
        };
        if duplicate {
            item.candidate.duplicate_status = DuplicateStatus::Exact;
            item.included = false;
        }
        if item.is_payment {
            item.candidate.suggested_category_id = Some("credit-card-payment".into());
            item.candidate.suggested_category_name = Some("Pagamento de fatura".into());
        }
    }
    mark_intra_file_duplicates(&account_id, &mut parsed.items);
    apply_category_suggestions_to(
        &state.db,
        &account_id,
        &rules,
        parsed
            .items
            .iter_mut()
            .filter(|item| !item.is_payment)
            .map(|item| &mut item.candidate),
        true,
    )
    .await?;
    let totals = totals(&parsed.items)?;
    let session_id = Uuid::new_v4().to_string();
    let file_name = path
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("fatura.csv")
        .to_string();
    state.credit_card_sessions.lock().await.insert(
        session_id.clone(),
        CreditCardImportSession {
            account_id: account_id.clone(),
            file_name: file_name.clone(),
            due_date: due_date.clone(),
            items: parsed.items.clone(),
        },
    );
    Ok(CreditCardImportPreview {
        session_id,
        file_name,
        account_id,
        due_date,
        purchases_in_cents: totals.purchases_in_cents,
        credits_in_cents: totals.credits_in_cents,
        total_in_cents: totals.total_in_cents,
        items: parsed.items,
    })
}

#[tauri::command]
pub async fn detect_import_kind(path: String) -> Result<String, AppError> {
    // Only report the official/legacy formats here. A CSV that merely matches a
    // saved custom mapping profile must NOT be reported as "known_*": that would
    // route it to the official template parser. Such files fall through to
    // "unknown_csv" so the frontend opens the mapping flow, where the saved
    // profile is applied and parsed with the mapped importer.
    let path = PathBuf::from(path);
    Ok(detect_import_kind_from_file(&path)?.as_str().into())
}

#[tauri::command]
pub async fn create_credit_card_account(
    name: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    if !(2..=80).contains(&name.trim().chars().count()) {
        return Err(AppError::Validation(
            "O nome do cartão deve ter entre 2 e 80 caracteres".into(),
        ));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,'credit_card')")
        .bind(&id)
        .bind(name.trim())
        .execute(&state.db)
        .await?;
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
        "SELECT kind FROM accounts WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&account_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Validation("Cartão não encontrado".into()))?;
    if account_kind != "credit_card" {
        return Err(AppError::Validation(
            "Selecione uma conta do tipo cartão".into(),
        ));
    }
    let path = PathBuf::from(path);
    build_credit_card_preview(
        parse_credit_card_csv(&path)?,
        path,
        account_id,
        due_date,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn preview_mapped_credit_card_import(
    path: String,
    account_id: String,
    mapping: CsvMappingDraft,
    state: State<'_, AppState>,
) -> Result<CreditCardImportPreview, AppError> {
    let account_kind = sqlx::query_scalar::<_, String>(
        "SELECT kind FROM accounts WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&account_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Validation("Cartão não encontrado".into()))?;
    if account_kind != "credit_card" {
        return Err(AppError::Validation(
            "Selecione uma conta do tipo cartão".into(),
        ));
    }
    validate_mapping_draft(&mapping)?;
    let path = PathBuf::from(path);
    build_credit_card_preview(
        parse_mapped_credit_card_csv(&path, &mapping)?,
        path,
        account_id,
        None,
        &state,
    )
    .await
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
    if let Some(date) = &due_date {
        validate_date(date)?;
    }
    let _commit_guard = state.import_commit.lock().await;
    let category_name = if let Some(id) = &category_id {
        Some(
            sqlx::query_scalar::<_, String>(
                "SELECT name FROM categories WHERE id=? AND deleted_at IS NULL",
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::Validation("Categoria não encontrada".into()))?,
        )
    } else {
        None
    };
    let mut sessions = state.credit_card_sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or(AppError::SessionExpired)?;
    if let Some(date) = due_date {
        session.due_date = date;
    }
    let item = session
        .items
        .iter_mut()
        .find(|x| x.candidate.source_row == source_row)
        .ok_or_else(|| AppError::Validation("Item da fatura não encontrado".into()))?;
    if matches!(item.candidate.duplicate_status, DuplicateStatus::Exact) && included {
        return Err(AppError::Validation(
            "Um lançamento duplicado não pode ser incluído".into(),
        ));
    }
    item.included = included;
    item.candidate.suggested_category_id = category_id;
    item.candidate.suggested_category_name = category_name;
    item.candidate.suggested_rule_id = None;
    item.candidate.suggested_rule_name = None;
    item.candidate.suggestion_source = None;
    let totals = totals(&session.items)?;
    Ok(CreditCardImportPreview {
        session_id,
        file_name: session.file_name.clone(),
        account_id: session.account_id.clone(),
        due_date: session.due_date.clone(),
        purchases_in_cents: totals.purchases_in_cents,
        credits_in_cents: totals.credits_in_cents,
        total_in_cents: totals.total_in_cents,
        items: session.items.clone(),
    })
}

#[tauri::command]
pub async fn update_credit_card_import_categories(
    session_id: String,
    source_rows: Vec<usize>,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<CreditCardImportPreview, AppError> {
    let _commit_guard = state.import_commit.lock().await;
    let rows: HashSet<usize> = source_rows.into_iter().collect();
    if rows.is_empty() {
        return Err(AppError::Validation("Selecione ao menos um item".into()));
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
    let mut sessions = state.credit_card_sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or(AppError::SessionExpired)?;
    if let Some((_, kind)) = &category {
        let incompatible = session.items.iter().any(|item| {
            rows.contains(&item.candidate.source_row)
                && !category_compatible(
                    kind,
                    item.candidate.amount_in_cents,
                    SuggestionContext::CreditCard,
                    false,
                )
        });
        if incompatible {
            return Err(AppError::Validation(
                "A categoria não é compatível com um ou mais itens da fatura".into(),
            ));
        }
    }
    update_credit_card_import_categories_impl(
        session,
        &rows,
        category_id,
        category.map(|(name, _)| name),
    )?;
    let totals = totals(&session.items)?;
    Ok(CreditCardImportPreview {
        session_id,
        file_name: session.file_name.clone(),
        account_id: session.account_id.clone(),
        due_date: session.due_date.clone(),
        purchases_in_cents: totals.purchases_in_cents,
        credits_in_cents: totals.credits_in_cents,
        total_in_cents: totals.total_in_cents,
        items: session.items.clone(),
    })
}

fn update_credit_card_import_categories_impl(
    session: &mut CreditCardImportSession,
    rows: &HashSet<usize>,
    category_id: Option<String>,
    category_name: Option<String>,
) -> Result<(), AppError> {
    let selected: Vec<_> = session
        .items
        .iter()
        .filter(|item| rows.contains(&item.candidate.source_row))
        .collect();
    if selected.len() != rows.len() {
        return Err(AppError::Validation(
            "Um ou mais itens não foram encontrados na sessão".into(),
        ));
    }
    if selected.iter().any(|item| item.is_payment) {
        return Err(AppError::Validation(
            "Pagamentos de fatura não podem ser recategorizados em grupo".into(),
        ));
    }
    for item in session
        .items
        .iter_mut()
        .filter(|item| rows.contains(&item.candidate.source_row))
    {
        item.candidate.suggested_category_id = category_id.clone();
        item.candidate.suggested_category_name = category_name.clone();
        item.candidate.suggested_rule_id = None;
        item.candidate.suggested_rule_name = None;
        item.candidate.suggestion_source = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn commit_credit_card_import(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let _commit_guard = state.import_commit.lock().await;
    let session = state
        .credit_card_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or(AppError::SessionExpired)?;
    let invoice_id = commit_credit_card_import_impl(session, &state.db).await?;
    state.credit_card_sessions.lock().await.remove(&session_id);
    Ok(invoice_id)
}

pub(crate) async fn commit_credit_card_import_impl(
    session: CreditCardImportSession,
    db: &SqlitePool,
) -> Result<String, AppError> {
    let mut tx = db.begin().await?;
    let mut seen_external = HashSet::new();
    let mut seen_fingerprint = HashSet::new();
    for item in session.items.iter().filter(|x| x.included) {
        let fp = item_fingerprint(&session.account_id, item);
        let conflict = if let Some(id) = item.candidate.external_id.as_deref() {
            !seen_external.insert(id.to_string()) || sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE account_id=? AND external_id=? AND deleted_at IS NULL").bind(&session.account_id).bind(id).fetch_one(&mut *tx).await? > 0
        } else {
            !seen_fingerprint.insert(fp.clone()) || sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE account_id=? AND fingerprint=? AND deleted_at IS NULL").bind(&session.account_id).bind(fp).fetch_one(&mut *tx).await? > 0
        };
        if conflict {
            return Err(AppError::Validation(
                "O arquivo contém lançamentos que já foram importados".into(),
            ));
        }
    }
    let included: Vec<_> = session
        .items
        .iter()
        .filter(|x| x.included)
        .cloned()
        .collect();
    if included.is_empty() {
        return Err(AppError::Validation(
            "Selecione ao menos um item da fatura".into(),
        ));
    }
    let totals = totals(&included)?;
    let batch_id = Uuid::new_v4().to_string();
    let invoice_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO import_batches(id,file_name,created_at) VALUES(?,?,datetime('now'))")
        .bind(&batch_id)
        .bind(&session.file_name)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO credit_card_invoices(id,account_id,due_date,purchases_cents,credits_cents,total_cents,status,import_batch_id)
         VALUES(?,?,?,?,?,?,?,?)"
    ).bind(&invoice_id).bind(&session.account_id).bind(&session.due_date)
        .bind(totals.purchases_in_cents).bind(totals.credits_in_cents).bind(totals.total_in_cents)
        .bind(if totals.total_in_cents <= 0 { "paid" } else { "open" })
        .bind(&batch_id).execute(&mut *tx).await?;
    for item in included {
        let transaction_id = Uuid::new_v4().to_string();
        let source = match item.candidate.suggestion_source {
            Some(SuggestionSource::Rule) => Some("rule"),
            Some(SuggestionSource::History) => Some("history"),
            None if item.candidate.suggested_category_id.is_some() => Some("manual"),
            None => None,
        };
        let merchant = merchant_key(&item.candidate.normalized_description);
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,merchant_key,amount_cents,fingerprint,
             category_id,category_source,categorization_rule_id,status,import_batch_id,external_id)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(&transaction_id).bind(&session.account_id).bind(&item.candidate.date)
            .bind(&item.candidate.description).bind(&item.candidate.normalized_description).bind(&merchant)
            .bind(item.candidate.amount_in_cents).bind(item_fingerprint(&session.account_id, &item))
            .bind(&item.candidate.suggested_category_id).bind(source)
            .bind(&item.candidate.suggested_rule_id).bind("cleared").bind(&batch_id).bind(&item.candidate.external_id)
            .execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO credit_card_invoice_items(invoice_id,transaction_id,holder,installment,source_row,raw_amount_cents,line_kind)
             VALUES(?,?,?,?,?,?,?)"
        ).bind(&invoice_id).bind(&transaction_id).bind(&item.holder).bind(&item.installment)
            .bind(item.candidate.source_row as i64).bind(item.raw_amount_in_cents).bind(item.line_kind.as_str())
            .execute(&mut *tx).await?;
        if let Some(rule_id) = item.candidate.suggested_rule_id {
            sqlx::query("UPDATE categorization_rules SET use_count=use_count+1 WHERE id=?")
                .bind(rule_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(invoice_id)
}

#[tauri::command]
pub async fn list_credit_card_invoices(
    state: State<'_, AppState>,
) -> Result<Vec<CreditCardInvoice>, AppError> {
    let rows = sqlx::query(
        "SELECT i.id,i.account_id,a.name account_name,i.due_date,i.purchases_cents,i.credits_cents,
         i.total_cents,i.status,i.payment_transaction_id,t.description payment_description,t.date payment_date
         FROM credit_card_invoices i JOIN accounts a ON a.id=i.account_id
         LEFT JOIN transactions t ON t.id=i.payment_transaction_id
         WHERE i.deleted_at IS NULL ORDER BY i.due_date DESC"
    ).fetch_all(&state.db).await?;
    Ok(rows
        .into_iter()
        .map(|r| CreditCardInvoice {
            id: r.get("id"),
            account_id: r.get("account_id"),
            account_name: r.get("account_name"),
            due_date: r.get("due_date"),
            purchases_in_cents: r.get("purchases_cents"),
            credits_in_cents: r.get("credits_cents"),
            total_in_cents: r.get("total_cents"),
            status: r.get("status"),
            payment_transaction_id: r.get("payment_transaction_id"),
            payment_description: r.get("payment_description"),
            payment_date: r.get("payment_date"),
        })
        .collect())
}

#[tauri::command]
pub async fn list_credit_card_invoices_page(
    filter: CreditCardInvoicePageFilter,
    state: State<'_, AppState>,
) -> Result<CreditCardInvoicePage, AppError> {
    let total_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM credit_card_invoices WHERE deleted_at IS NULL")
            .fetch_one(&state.db)
            .await?;
    let limit = filter.limit.unwrap_or(10).clamp(1, 1000);
    let offset = filter.offset.unwrap_or(0).max(0);
    let rows = sqlx::query(
        "SELECT i.id,i.account_id,a.name account_name,i.due_date,i.purchases_cents,i.credits_cents,
         i.total_cents,i.status,i.payment_transaction_id,t.description payment_description,t.date payment_date
         FROM credit_card_invoices i JOIN accounts a ON a.id=i.account_id
         LEFT JOIN transactions t ON t.id=i.payment_transaction_id
         WHERE i.deleted_at IS NULL ORDER BY i.due_date DESC,i.id DESC LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;
    let items = rows
        .into_iter()
        .map(|r| CreditCardInvoice {
            id: r.get("id"),
            account_id: r.get("account_id"),
            account_name: r.get("account_name"),
            due_date: r.get("due_date"),
            purchases_in_cents: r.get("purchases_cents"),
            credits_in_cents: r.get("credits_cents"),
            total_in_cents: r.get("total_cents"),
            status: r.get("status"),
            payment_transaction_id: r.get("payment_transaction_id"),
            payment_description: r.get("payment_description"),
            payment_date: r.get("payment_date"),
        })
        .collect();
    Ok(CreditCardInvoicePage { items, total_count })
}

#[tauri::command]
pub async fn get_credit_card_invoice_items(
    invoice_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<CreditCardInvoiceItem>, AppError> {
    let rows = sqlx::query(
        "SELECT t.id transaction_id,t.date,t.description,t.amount_cents,t.category_id,c.name category_name,
         x.holder,x.installment,x.source_row,x.raw_amount_cents,x.line_kind,
         EXISTS(SELECT 1 FROM transaction_links l WHERE l.credit_transaction_id=t.id) is_linked
         FROM credit_card_invoice_items x JOIN transactions t ON t.id=x.transaction_id
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE x.invoice_id=? AND t.deleted_at IS NULL ORDER BY t.date,x.source_row"
    ).bind(invoice_id).fetch_all(&state.db).await?;
    Ok(rows
        .into_iter()
        .map(|r| CreditCardInvoiceItem {
            transaction_id: r.get("transaction_id"),
            date: r.get("date"),
            description: r.get("description"),
            amount_in_cents: r.get("amount_cents"),
            category_id: r.get("category_id"),
            category_name: r.get("category_name"),
            holder: r.get("holder"),
            installment: r.get("installment"),
            source_row: r.get("source_row"),
            line_kind: r.get("line_kind"),
            is_payment: r.get::<String, _>("line_kind") == "payment",
            is_linked: r.get::<i64, _>("is_linked") != 0,
        })
        .collect())
}

#[tauri::command]
pub async fn find_invoice_payment_matches(
    invoice_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentMatchCandidate>, AppError> {
    let invoice = sqlx::query("SELECT due_date,total_cents,payment_transaction_id FROM credit_card_invoices WHERE id=? AND deleted_at IS NULL")
        .bind(&invoice_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::Validation("Fatura não encontrada".into()))?;
    if invoice
        .get::<Option<String>, _>("payment_transaction_id")
        .is_some()
    {
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
         ORDER BY distance,t.date",
    )
    .bind(&due_date)
    .bind(-total.abs())
    .bind(&due_date)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PaymentMatchCandidate {
            transaction_id: r.get("id"),
            account_name: r.get("account_name"),
            date: r.get("date"),
            description: r.get("description"),
            amount_in_cents: r.get("amount_cents"),
            distance_in_days: r.get("distance"),
        })
        .collect())
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
    if invoice
        .get::<Option<String>, _>("payment_transaction_id")
        .is_some()
    {
        return Err(AppError::Validation(
            "Esta fatura já possui um pagamento".into(),
        ));
    }
    let bank = sqlx::query(
        "SELECT t.amount_cents,t.category_id,t.category_source,t.categorization_rule_id
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind!='credit_card'",
    )
    .bind(&bank_transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Pagamento bancário não encontrado".into()))?;
    if bank.get::<i64, _>("amount_cents") != -invoice.get::<i64, _>("total_cents").abs() {
        return Err(AppError::Validation(
            "O pagamento precisa ter o mesmo valor da fatura".into(),
        ));
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
    sqlx::query(
        "UPDATE credit_card_invoices SET payment_transaction_id=?,status='paid' WHERE id=?",
    )
    .bind(&bank_transaction_id)
    .bind(&invoice_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE transactions SET category_id='credit-card-payment',category_source='manual',categorization_rule_id=NULL WHERE id=?")
        .bind(&bank_transaction_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(TransactionLink {
        id: link_id,
        debit_transaction_id: bank_transaction_id,
        credit_transaction_id: None,
        invoice_id: Some(invoice_id),
    })
}

#[tauri::command]
pub async fn unlink_invoice_payment(
    invoice_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let link = sqlx::query(
        "SELECT debit_transaction_id,previous_category_id,previous_category_source,previous_rule_id
         FROM transaction_links WHERE invoice_id=?",
    )
    .bind(&invoice_id)
    .fetch_optional(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM transaction_links WHERE invoice_id=?")
        .bind(&invoice_id)
        .execute(&mut *tx)
        .await?;
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
pub async fn set_invoice_status(
    invoice_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if status != "paid" && status != "open" {
        return Err(AppError::Validation("Status inválido".into()));
    }
    sqlx::query("UPDATE credit_card_invoices SET status=? WHERE id=?")
        .bind(status)
        .bind(invoice_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn find_card_payment_matches(
    credit_transaction_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentMatchCandidate>, AppError> {
    let payment = sqlx::query(
        "SELECT t.date,t.amount_cents FROM transactions t JOIN accounts a ON a.id=t.account_id
         JOIN credit_card_invoice_items x ON x.transaction_id=t.id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind='credit_card'
         AND t.amount_cents>0 AND x.line_kind='payment'",
    )
    .bind(&credit_transaction_id)
    .fetch_optional(&state.db)
    .await?
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
         ORDER BY distance,t.date",
    )
    .bind(&date)
    .bind(-amount)
    .bind(&date)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PaymentMatchCandidate {
            transaction_id: r.get("id"),
            account_name: r.get("account_name"),
            date: r.get("date"),
            description: r.get("description"),
            amount_in_cents: r.get("amount_cents"),
            distance_in_days: r.get("distance"),
        })
        .collect())
}

#[tauri::command]
pub async fn link_card_payment(
    credit_transaction_id: String,
    bank_transaction_id: String,
    state: State<'_, AppState>,
) -> Result<TransactionLink, AppError> {
    let mut tx = state.db.begin().await?;
    let credit = sqlx::query_scalar::<_, i64>(
        "SELECT t.amount_cents FROM transactions t JOIN accounts a ON a.id=t.account_id
         JOIN credit_card_invoice_items x ON x.transaction_id=t.id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind='credit_card'
         AND t.amount_cents>0 AND x.line_kind='payment'",
    )
    .bind(&credit_transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Crédito de pagamento não encontrado".into()))?;
    let bank = sqlx::query(
        "SELECT t.amount_cents,t.category_id,t.category_source,t.categorization_rule_id
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         WHERE t.id=? AND t.deleted_at IS NULL AND a.kind!='credit_card'",
    )
    .bind(&bank_transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Débito bancário não encontrado".into()))?;
    if bank.get::<i64, _>("amount_cents") != -credit {
        return Err(AppError::Validation(
            "Os dois lados do pagamento precisam ter o mesmo valor".into(),
        ));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO transaction_links(id,kind,debit_transaction_id,credit_transaction_id,previous_category_id,previous_category_source,previous_rule_id)
         VALUES(?,'credit_card_payment',?,?,?,?,?)"
    ).bind(&id).bind(&bank_transaction_id).bind(&credit_transaction_id)
        .bind(bank.get::<Option<String>,_>("category_id"))
        .bind(bank.get::<Option<String>,_>("category_source"))
        .bind(bank.get::<Option<String>,_>("categorization_rule_id"))
        .execute(&mut *tx).await?;
    for transaction_id in [&bank_transaction_id, &credit_transaction_id] {
        sqlx::query("UPDATE transactions SET category_id='credit-card-payment',category_source='manual',categorization_rule_id=NULL WHERE id=?")
            .bind(transaction_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(TransactionLink {
        id,
        debit_transaction_id: bank_transaction_id,
        credit_transaction_id: Some(credit_transaction_id),
        invoice_id: None,
    })
}

#[tauri::command]
pub async fn unlink_card_payment(
    credit_transaction_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let link = sqlx::query(
        "SELECT debit_transaction_id,previous_category_id,previous_category_source,previous_rule_id
         FROM transaction_links WHERE credit_transaction_id=?",
    )
    .bind(&credit_transaction_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Conciliação não encontrada".into()))?;
    sqlx::query("DELETE FROM transaction_links WHERE credit_transaction_id=?")
        .bind(&credit_transaction_id)
        .execute(&mut *tx)
        .await?;
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
    invoice_id: String,
    deleted: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    let batch_id = sqlx::query_scalar::<_, String>(
        "SELECT import_batch_id FROM credit_card_invoices WHERE id=?",
    )
    .bind(&invoice_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("Fatura não encontrada".into()))?;
    if deleted {
        let linked: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM transaction_links l
             WHERE l.invoice_id=? OR l.credit_transaction_id IN (
               SELECT transaction_id FROM credit_card_invoice_items WHERE invoice_id=?
             )",
        )
        .bind(&invoice_id)
        .bind(&invoice_id)
        .fetch_one(&mut *tx)
        .await?;
        if linked > 0 {
            return Err(AppError::Validation(
                "Desvincule os pagamentos conciliados antes de excluir a fatura".into(),
            ));
        }
        sqlx::query("UPDATE credit_card_invoices SET deleted_at=datetime('now'),payment_transaction_id=NULL WHERE id=?")
            .bind(&invoice_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE transactions SET deleted_at=datetime('now') WHERE import_batch_id=?")
            .bind(&batch_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE import_batches SET undone_at=datetime('now') WHERE id=?")
            .bind(&batch_id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query("UPDATE credit_card_invoices SET deleted_at=NULL WHERE id=?")
            .bind(&invoice_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE transactions SET deleted_at=NULL WHERE import_batch_id=?")
            .bind(&batch_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE import_batches SET undone_at=NULL WHERE id=?")
            .bind(&batch_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::credit_card::CreditCardLineKind;
    use crate::domain::import::{DuplicateStatus, ImportCandidate};

    fn card_item(description: &str, external_id: Option<&str>) -> CreditCardImportItem {
        CreditCardImportItem::new(
            ImportCandidate {
                source_row: 1,
                date: "2026-06-01".into(),
                description: description.into(),
                normalized_description: description.to_uppercase(),
                amount_in_cents: -1000,
                external_id: external_id.map(str::to_owned),
                suggested_category_id: None,
                suggested_category_name: None,
                suggested_rule_id: None,
                suggested_rule_name: None,
                suggestion_source: None,
                merchant_key: String::new(),
                category_suggestions: vec![],
                duplicate_status: DuplicateStatus::New,
                warnings: vec![],
                included: true,
            },
            None,
            None,
            1000,
            CreditCardLineKind::Purchase,
        )
    }

    #[test]
    fn grouped_card_category_update_is_atomic_and_protects_payments() {
        let mut first = card_item("Compra um", None);
        first.candidate.source_row = 1;
        let mut second = card_item("Compra dois", None);
        second.candidate.source_row = 2;
        let mut payment = card_item("Pagamento fatura", None);
        payment.candidate.source_row = 3;
        payment.is_payment = true;
        let mut session = CreditCardImportSession {
            account_id: "card".into(),
            file_name: "fatura.csv".into(),
            due_date: "2026-06-10".into(),
            items: vec![first, second, payment],
        };
        update_credit_card_import_categories_impl(
            &mut session,
            &HashSet::from([1, 2]),
            Some("restaurants".into()),
            Some("Restaurantes".into()),
        )
        .unwrap();
        assert!(session.items[..2].iter().all(|item| {
            item.candidate.suggested_category_id.as_deref() == Some("restaurants")
        }));
        assert_eq!(session.items[2].candidate.suggested_category_id, None);

        let before = session
            .items
            .iter()
            .map(|item| item.candidate.suggested_category_id.clone())
            .collect::<Vec<_>>();
        assert!(update_credit_card_import_categories_impl(
            &mut session,
            &HashSet::from([1, 3]),
            Some("health".into()),
            Some("Saúde".into()),
        )
        .is_err());
        assert_eq!(
            before,
            session
                .items
                .iter()
                .map(|item| item.candidate.suggested_category_id.clone())
                .collect::<Vec<_>>()
        );
    }

    async fn card_test_setup() -> (tempfile::TempDir, sqlx::SqlitePool, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::infrastructure::database::connect(&directory.path().join("card.db"))
            .await
            .unwrap();
        let account_id = "card-account".to_string();
        sqlx::query("INSERT INTO accounts(id,name,kind) VALUES(?,?,?)")
            .bind(&account_id)
            .bind("Cartão")
            .bind("credit_card")
            .execute(&db)
            .await
            .unwrap();
        (directory, db, account_id)
    }

    #[tokio::test]
    async fn card_commit_conflicts_are_atomic_and_success_persists_external_id() {
        let (_directory, db, account_id) = card_test_setup().await;
        let external = card_item("EXTERNO", Some("card-existing"));
        let fingerprint_item = card_item("FINGERPRINT", None);
        for (id, item, external_id) in [
            ("card-existing-row", &external, Some("card-existing")),
            ("card-fingerprint-row", &fingerprint_item, None),
        ] {
            sqlx::query("INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,status,external_id) VALUES(?,?,?,?,?,?,?,'cleared',?)")
                .bind(id).bind(&account_id).bind(&item.candidate.date).bind(&item.candidate.description)
                .bind(&item.candidate.normalized_description).bind(item.candidate.amount_in_cents)
                .bind(item_fingerprint(&account_id, item)).bind(external_id).execute(&db).await.unwrap();
        }
        let session = |items| CreditCardImportSession {
            account_id: account_id.clone(),
            file_name: "fatura.csv".into(),
            due_date: "2026-06-10".into(),
            items,
        };
        let batches_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_batches")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(commit_credit_card_import_impl(session(vec![external]), &db)
            .await
            .is_err());
        assert!(
            commit_credit_card_import_impl(session(vec![fingerprint_item]), &db)
                .await
                .is_err()
        );
        assert_eq!(
            batches_before,
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM import_batches")
                .fetch_one(&db)
                .await
                .unwrap()
        );
        let success = card_item("NOVO", Some("card-new"));
        let before_transactions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transactions")
            .fetch_one(&db)
            .await
            .unwrap();
        let invoice_id = commit_credit_card_import_impl(session(vec![success]), &db)
            .await
            .unwrap();
        assert_eq!(
            before_transactions + 1,
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions")
                .fetch_one(&db)
                .await
                .unwrap()
        );
        let persisted: Option<String> = sqlx::query_scalar("SELECT external_id FROM transactions WHERE import_batch_id=(SELECT import_batch_id FROM credit_card_invoices WHERE id=? )").bind(invoice_id).fetch_one(&db).await.unwrap();
        assert_eq!(persisted.as_deref(), Some("card-new"));
        assert_eq!(1_i64, sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM credit_card_invoice_items WHERE invoice_id=(SELECT id FROM credit_card_invoices ORDER BY rowid DESC LIMIT 1)").fetch_one(&db).await.unwrap());
    }
}
