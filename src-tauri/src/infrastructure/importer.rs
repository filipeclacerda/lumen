use std::{fs, path::Path};

use chrono::NaiveDate;
use csv::{ReaderBuilder, StringRecord};
use regex::Regex;

use crate::{
    domain::{
        credit_card::{CreditCardImportItem, ParsedCreditCardInvoice},
        import::{
            normalize_description, CsvColumnMapping, CsvColumnRole, CsvMappingDraft, DuplicateStatus,
            ImportCandidate, ImportSourceKind, NormalizedImportRow,
        },
        money::parse_brl,
    },
    error::AppError,
};

#[derive(Debug, Clone)]
pub struct CsvInspection {
    pub delimiter: String,
    pub headers: Vec<String>,
    pub sample_rows: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectedImportKind {
    KnownBank,
    KnownCreditCard,
    UnknownCsv,
}

impl DetectedImportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::KnownBank => "known_bank",
            Self::KnownCreditCard => "known_credit_card",
            Self::UnknownCsv => "unknown_csv",
        }
    }
}

pub fn parse_file(path: &Path) -> Result<Vec<ImportCandidate>, AppError> {
    match path.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase().as_str() {
        "csv" => parse_csv_path(path),
        "ofx" => parse_ofx(&fs::read_to_string(path)?),
        "pdf" => parse_sicoob_pdf(path),
        _ => Err(AppError::UnsupportedFormat),
    }
}

pub fn detect_import_kind(path: &Path) -> Result<DetectedImportKind, AppError> {
    match path.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase().as_str() {
        "ofx" | "pdf" => Ok(DetectedImportKind::KnownBank),
        "csv" => detect_csv_kind(&fs::read_to_string(path)?),
        _ => Err(AppError::UnsupportedFormat),
    }
}

pub fn inspect_csv_file(path: &Path) -> Result<CsvInspection, AppError> {
    let content = fs::read_to_string(path)?;
    inspect_csv_content(&content)
}

pub fn parse_credit_card_csv(path: &Path) -> Result<ParsedCreditCardInvoice, AppError> {
    let content = fs::read_to_string(path)?;
    let inspection = inspect_csv_content(&content)?;
    let normalized_headers = inspection.headers.iter().map(|header| normalize_header(header)).collect::<Vec<_>>();
    if is_legacy_credit_card_headers(&normalized_headers) {
        return parse_legacy_credit_card_csv(&content);
    }
    if is_credit_card_template_headers(&normalized_headers) {
        return parse_mapped_credit_card_rows(
            read_csv_rows(&content, delimiter_char(&inspection.delimiter)?)?,
            &credit_card_template_draft(&inspection.headers),
        );
    }
    Err(AppError::Validation(
        "CSV de fatura inválido; esperado: Data;Estabelecimento;Portador;Valor;Parcela ou o template oficial".into(),
    ))
}

pub fn parse_mapped_bank_csv(path: &Path, mapping: &CsvMappingDraft) -> Result<Vec<ImportCandidate>, AppError> {
    let content = fs::read_to_string(path)?;
    parse_mapped_bank_rows(read_csv_rows(&content, delimiter_from_draft(mapping)?)?, mapping)
}

pub fn parse_mapped_credit_card_csv(path: &Path, mapping: &CsvMappingDraft) -> Result<ParsedCreditCardInvoice, AppError> {
    let content = fs::read_to_string(path)?;
    parse_mapped_credit_card_rows(read_csv_rows(&content, delimiter_from_draft(mapping)?)?, mapping)
}

fn parse_csv_path(path: &Path) -> Result<Vec<ImportCandidate>, AppError> {
    let content = fs::read_to_string(path)?;
    let inspection = inspect_csv_content(&content)?;
    let normalized_headers = inspection.headers.iter().map(|header| normalize_header(header)).collect::<Vec<_>>();
    if is_bank_template_headers(&normalized_headers) {
        return parse_mapped_bank_rows(
            read_csv_rows(&content, delimiter_char(&inspection.delimiter)?)?,
            &bank_template_draft(&inspection.headers),
        );
    }
    if is_credit_card_template_headers(&normalized_headers) || is_legacy_credit_card_headers(&normalized_headers) {
        return Err(AppError::Validation("Este CSV deve ser importado no fluxo de cartão de crédito".into()));
    }
    parse_csv_legacy(&content)
}

fn detect_csv_kind(content: &str) -> Result<DetectedImportKind, AppError> {
    let inspection = inspect_csv_content(content)?;
    let headers = inspection.headers.iter().map(|header| normalize_header(header)).collect::<Vec<_>>();
    if is_legacy_credit_card_headers(&headers) || is_credit_card_template_headers(&headers) {
        return Ok(DetectedImportKind::KnownCreditCard);
    }
    if is_bank_template_headers(&headers) || looks_like_legacy_bank_csv(&headers) {
        return Ok(DetectedImportKind::KnownBank);
    }
    Ok(DetectedImportKind::UnknownCsv)
}

fn inspect_csv_content(content: &str) -> Result<CsvInspection, AppError> {
    let delimiter = guess_delimiter(content);
    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(strip_bom(content).as_bytes());
    let headers = reader.headers().map_err(|e| AppError::Validation(e.to_string()))?
        .iter()
        .map(|value| value.trim().to_string())
        .collect::<Vec<_>>();
    if headers.is_empty() {
        return Err(AppError::Validation("O CSV não contém cabeçalhos".into()));
    }
    let sample_rows = reader.records().take(5).map(|record| {
        record
            .map(|row| row.iter().map(|value| value.trim().to_string()).collect::<Vec<_>>())
            .map_err(|e| AppError::Validation(e.to_string()))
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(CsvInspection {
        delimiter: (delimiter as char).to_string(),
        headers,
        sample_rows,
    })
}

fn bank_template_draft(headers: &[String]) -> CsvMappingDraft {
    CsvMappingDraft {
        source_kind: ImportSourceKind::Bank,
        delimiter: ";".into(),
        date_format: Some("yyyy-MM-dd".into()),
        decimal_separator: Some("comma".into()),
        default_due_date: None,
        profile_name: Some("Template conta corrente".into()),
        columns: headers.iter().enumerate().map(|(index, header)| CsvColumnMapping {
            index,
            header: header.clone(),
            role: match normalize_header(header).as_str() {
                "date" => CsvColumnRole::Date,
                "description" => CsvColumnRole::Description,
                "amount" => CsvColumnRole::SignedAmount,
                "external_id" => CsvColumnRole::ExternalId,
                "balance" => CsvColumnRole::Balance,
                _ => CsvColumnRole::Ignore,
            },
        }).collect(),
    }
}

fn credit_card_template_draft(headers: &[String]) -> CsvMappingDraft {
    CsvMappingDraft {
        source_kind: ImportSourceKind::CreditCard,
        delimiter: ";".into(),
        date_format: Some("yyyy-MM-dd".into()),
        decimal_separator: Some("comma".into()),
        default_due_date: None,
        profile_name: Some("Template cartao de credito".into()),
        columns: headers.iter().enumerate().map(|(index, header)| CsvColumnMapping {
            index,
            header: header.clone(),
            role: match normalize_header(header).as_str() {
                "purchase_date" => CsvColumnRole::PurchaseDate,
                "description" => CsvColumnRole::Description,
                "amount" => CsvColumnRole::SignedAmount,
                "row_kind" => CsvColumnRole::RowKind,
                "holder" => CsvColumnRole::Holder,
                "installment" => CsvColumnRole::Installment,
                "due_date" => CsvColumnRole::DueDate,
                "external_id" => CsvColumnRole::ExternalId,
                _ => CsvColumnRole::Ignore,
            },
        }).collect(),
    }
}

fn is_legacy_credit_card_headers(headers: &[String]) -> bool {
    headers == ["data", "estabelecimento", "portador", "valor", "parcela"]
}

fn is_bank_template_headers(headers: &[String]) -> bool {
    headers == ["source_kind", "date", "description", "amount", "external_id", "balance"]
}

fn is_credit_card_template_headers(headers: &[String]) -> bool {
    headers == ["source_kind", "purchase_date", "description", "amount", "row_kind", "holder", "installment", "due_date", "external_id"]
}

fn looks_like_legacy_bank_csv(headers: &[String]) -> bool {
    let contains = |names: &[&str]| headers.iter().any(|header| names.iter().any(|needle| header.contains(needle)));
    contains(&["data", "date"]) && contains(&["descr", "hist", "memo"]) && contains(&["valor", "amount"])
}

fn guess_delimiter(content: &str) -> u8 {
    let line = strip_bom(content).lines().next().unwrap_or("");
    if line.matches(';').count() >= line.matches(',').count() { b';' } else { b',' }
}

fn strip_bom(content: &str) -> &str {
    content.trim_start_matches('\u{feff}')
}

fn delimiter_char(delimiter: &str) -> Result<u8, AppError> {
    delimiter
        .chars()
        .next()
        .map(|value| value as u8)
        .ok_or_else(|| AppError::Validation("Delimitador inválido".into()))
}

fn delimiter_from_draft(mapping: &CsvMappingDraft) -> Result<u8, AppError> {
    delimiter_char(&mapping.delimiter)
}

fn read_csv_rows(content: &str, delimiter: u8) -> Result<Vec<StringRecord>, AppError> {
    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(strip_bom(content).as_bytes());
    reader.records()
        .map(|record| record.map_err(|e| AppError::Validation(e.to_string())))
        .collect()
}

fn normalize_header(value: &str) -> String {
    value.trim().to_lowercase().replace(' ', "_")
}

fn role_index(columns: &[CsvColumnMapping], role: CsvColumnRole) -> Option<usize> {
    columns.iter().find(|column| column.role == role).map(|column| column.index)
}

fn read_optional(record: &StringRecord, index: Option<usize>) -> Option<String> {
    index.and_then(|i| record.get(i))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

fn parse_date(value: &str) -> Result<String, AppError> {
    for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"] {
        if let Ok(date) = NaiveDate::parse_from_str(value.trim(), fmt) {
            return Ok(date.format("%Y-%m-%d").to_string());
        }
    }
    Err(AppError::Validation(format!("Data inválida: {value}")))
}

fn parse_date_from_mapping(value: &str, format: Option<&str>) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Data ausente".into()));
    }
    let explicit = match format {
        Some("dd/MM/yyyy") => Some("%d/%m/%Y"),
        Some("yyyy-MM-dd") => Some("%Y-%m-%d"),
        Some("dd/MM/yy") => Some("%d/%m/%y"),
        _ => None,
    };
    if let Some(pattern) = explicit {
        return NaiveDate::parse_from_str(trimmed, pattern)
            .map(|date| date.format("%Y-%m-%d").to_string())
            .map_err(|_| AppError::Validation(format!("Data inválida: {value}")));
    }
    parse_date(trimmed)
}

fn parse_money_with_separator(value: &str, decimal_separator: Option<&str>) -> Result<i64, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Valor ausente".into()));
    }
    if decimal_separator.is_none() {
        return parse_brl(trimmed);
    }
    let negative = trimmed.starts_with('-')
        || trimmed.ends_with('-')
        || (trimmed.starts_with('(') && trimmed.ends_with(')'));
    let mut cleaned = trimmed
        .replace("R$", "")
        .replace("r$", "")
        .replace(char::is_whitespace, "")
        .trim_matches(|c: char| ['+', '-', '(', ')'].contains(&c))
        .to_string();
    cleaned = match decimal_separator.unwrap_or("comma") {
        "dot" => cleaned.replace(',', ""),
        _ => cleaned.replace('.', "").replace(',', "."),
    };
    let parsed = cleaned.parse::<f64>()
        .map_err(|_| AppError::Validation(format!("Valor inválido: {value}")))?;
    let cents = (parsed * 100.0).round() as i64;
    Ok(if negative { -cents } else { cents })
}

fn parse_optional_money(value: Option<&str>, decimal_separator: Option<&str>) -> Result<i64, AppError> {
    match value.map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => parse_money_with_separator(text, decimal_separator),
        None => Ok(0),
    }
}

fn parse_csv_legacy(content: &str) -> Result<Vec<ImportCandidate>, AppError> {
    let delimiter = guess_delimiter(content);
    let mut reader = ReaderBuilder::new().delimiter(delimiter).flexible(true).from_reader(strip_bom(content).as_bytes());
    let headers = reader.headers().map_err(|e| AppError::Validation(e.to_string()))?.clone();
    let index = |names: &[&str]| headers.iter().position(|header| names.iter().any(|needle| header.trim().to_lowercase().contains(needle)));
    let date_i = index(&["data", "date"]).ok_or_else(|| AppError::Validation("Coluna de data ausente".into()))?;
    let desc_i = index(&["descr", "hist", "memo"]).ok_or_else(|| AppError::Validation("Coluna de descrição ausente".into()))?;
    let amount_i = index(&["valor", "amount"]).ok_or_else(|| AppError::Validation("Coluna de valor ausente".into()))?;
    let id_i = index(&["id", "documento", "fitid"]);
    reader.records().enumerate().map(|(row, record)| {
        let record = record.map_err(|e| AppError::Validation(e.to_string()))?;
        let description = record.get(desc_i).unwrap_or("").trim().to_string();
        Ok(ImportCandidate {
            source_row: row + 2,
            date: parse_date(record.get(date_i).unwrap_or(""))?,
            normalized_description: normalize_description(&description),
            description,
            amount_in_cents: parse_brl(record.get(amount_i).unwrap_or(""))?,
            external_id: id_i.and_then(|i| record.get(i)).filter(|value| !value.is_empty()).map(String::from),
            suggested_category_id: None,
            suggested_category_name: None,
            suggested_rule_id: None,
            suggested_rule_name: None,
            duplicate_status: DuplicateStatus::New,
            warnings: vec![],
            included: true,
        })
    }).collect()
}

fn parse_mapped_bank_rows(rows: Vec<StringRecord>, mapping: &CsvMappingDraft) -> Result<Vec<ImportCandidate>, AppError> {
    if mapping.source_kind != ImportSourceKind::Bank {
        return Err(AppError::Validation("O layout informado não é de conta bancária".into()));
    }
    let date_i = role_index(&mapping.columns, CsvColumnRole::Date)
        .ok_or_else(|| AppError::Validation("Mapeie uma coluna de data".into()))?;
    let desc_i = role_index(&mapping.columns, CsvColumnRole::Description)
        .ok_or_else(|| AppError::Validation("Mapeie uma coluna de descrição".into()))?;
    let signed_i = role_index(&mapping.columns, CsvColumnRole::SignedAmount);
    let debit_i = role_index(&mapping.columns, CsvColumnRole::DebitAmount);
    let credit_i = role_index(&mapping.columns, CsvColumnRole::CreditAmount);
    if signed_i.is_none() && debit_i.is_none() && credit_i.is_none() {
        return Err(AppError::Validation("Mapeie uma coluna de valor ou as colunas de débito e crédito".into()));
    }
    let external_i = role_index(&mapping.columns, CsvColumnRole::ExternalId);
    let rows = rows.into_iter().enumerate().map(|(row_index, record)| {
        let description = record.get(desc_i).unwrap_or("").trim().to_string();
        if description.is_empty() {
            return Err(AppError::Validation(format!("Descrição ausente na linha {}", row_index + 2)));
        }
        let amount_in_cents = if let Some(index) = signed_i {
            parse_money_with_separator(record.get(index).unwrap_or(""), mapping.decimal_separator.as_deref())?
        } else {
            let debit = parse_optional_money(debit_i.and_then(|i| record.get(i)), mapping.decimal_separator.as_deref())?;
            let credit = parse_optional_money(credit_i.and_then(|i| record.get(i)), mapping.decimal_separator.as_deref())?;
            credit - debit
        };
        if amount_in_cents == 0 {
            return Err(AppError::Validation(format!("Valor inválido na linha {}", row_index + 2)));
        }
        Ok(ImportCandidate {
            source_row: row_index + 2,
            date: parse_date_from_mapping(record.get(date_i).unwrap_or(""), mapping.date_format.as_deref())?,
            normalized_description: normalize_description(&description),
            description,
            amount_in_cents,
            external_id: external_i.and_then(|i| record.get(i)).map(str::trim).filter(|value| !value.is_empty()).map(String::from),
            suggested_category_id: None,
            suggested_category_name: None,
            suggested_rule_id: None,
            suggested_rule_name: None,
            duplicate_status: DuplicateStatus::New,
            warnings: vec![],
            included: true,
        })
    }).collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() {
        return Err(AppError::Validation("O CSV não contém lançamentos".into()));
    }
    Ok(rows)
}

fn parse_mapped_credit_card_rows(rows: Vec<StringRecord>, mapping: &CsvMappingDraft) -> Result<ParsedCreditCardInvoice, AppError> {
    if mapping.source_kind != ImportSourceKind::CreditCard {
        return Err(AppError::Validation("O layout informado não é de cartão de crédito".into()));
    }
    let date_i = role_index(&mapping.columns, CsvColumnRole::PurchaseDate)
        .or_else(|| role_index(&mapping.columns, CsvColumnRole::Date))
        .ok_or_else(|| AppError::Validation("Mapeie uma coluna de data da compra".into()))?;
    let desc_i = role_index(&mapping.columns, CsvColumnRole::Description)
        .ok_or_else(|| AppError::Validation("Mapeie uma coluna de descrição".into()))?;
    let signed_i = role_index(&mapping.columns, CsvColumnRole::SignedAmount)
        .ok_or_else(|| AppError::Validation("Mapeie uma coluna de valor".into()))?;
    let holder_i = role_index(&mapping.columns, CsvColumnRole::Holder);
    let installment_i = role_index(&mapping.columns, CsvColumnRole::Installment);
    let row_kind_i = role_index(&mapping.columns, CsvColumnRole::RowKind);
    let due_date_i = role_index(&mapping.columns, CsvColumnRole::DueDate);
    let external_i = role_index(&mapping.columns, CsvColumnRole::ExternalId);
    let mut due_date = mapping.default_due_date.clone();
    let mut items = Vec::new();
    for (row_index, record) in rows.into_iter().enumerate() {
        let description = record.get(desc_i).unwrap_or("").trim().to_string();
        if description.is_empty() {
            return Err(AppError::Validation(format!("Descrição ausente na linha {}", row_index + 2)));
        }
        let signed_amount = parse_money_with_separator(record.get(signed_i).unwrap_or(""), mapping.decimal_separator.as_deref())?;
        let gross_amount = signed_amount.abs();
        if gross_amount == 0 {
            return Err(AppError::Validation(format!("Valor inválido na linha {}", row_index + 2)));
        }
        let row_kind = normalize_row_kind(
            row_kind_i.and_then(|i| record.get(i)),
            signed_amount,
        )?;
        let amount_in_cents = match row_kind.as_str() {
            "purchase" => -gross_amount,
            "refund" => gross_amount,
            "payment" => gross_amount,
            _ => return Err(AppError::Validation(format!("Tipo de linha inválido na linha {}", row_index + 2))),
        };
        let row_due_date = due_date_i.and_then(|i| record.get(i))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| parse_date_from_mapping(value, mapping.date_format.as_deref()))
            .transpose()?;
        if due_date.is_none() {
            due_date = row_due_date.clone();
        }
        let normalized = NormalizedImportRow {
            source_row: row_index + 2,
            source_kind: ImportSourceKind::CreditCard,
            date: parse_date_from_mapping(record.get(date_i).unwrap_or(""), mapping.date_format.as_deref())?,
            description: description.clone(),
            amount_in_cents,
            external_id: external_i.and_then(|i| record.get(i)).map(str::trim).filter(|value| !value.is_empty()).map(String::from),
            row_kind: Some(row_kind.clone()),
            holder: read_optional(&record, holder_i),
            installment: read_optional(&record, installment_i),
            due_date: row_due_date,
            warnings: vec![],
        };
        items.push(CreditCardImportItem {
            candidate: ImportCandidate {
                source_row: normalized.source_row,
                date: normalized.date.clone(),
                description: normalized.description.clone(),
                normalized_description: normalize_description(&normalized.description),
                amount_in_cents: normalized.amount_in_cents,
                external_id: normalized.external_id.clone(),
                suggested_category_id: None,
                suggested_category_name: None,
                suggested_rule_id: None,
                suggested_rule_name: None,
                duplicate_status: DuplicateStatus::New,
                warnings: normalized.warnings.clone(),
                included: true,
            },
            holder: normalized.holder.clone(),
            installment: normalized.installment.clone(),
            raw_amount_in_cents: if row_kind == "purchase" { gross_amount } else { -gross_amount },
            included: true,
            is_payment: row_kind == "payment",
        });
    }
    if items.is_empty() {
        return Err(AppError::Validation("A fatura não contém lançamentos".into()));
    }
    Ok(ParsedCreditCardInvoice { due_date, items })
}

fn normalize_row_kind(value: Option<&str>, signed_amount: i64) -> Result<String, AppError> {
    let normalized = value.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        return Ok(if signed_amount < 0 { "refund" } else { "purchase" }.into());
    }
    match normalized.as_str() {
        "PURCHASE" | "COMPRA" => Ok("purchase".into()),
        "PAYMENT" | "PAGAMENTO" => Ok("payment".into()),
        "REFUND" | "REVERSAL" | "ESTORNO" => Ok("refund".into()),
        _ => Err(AppError::Validation(format!("Tipo de linha desconhecido: {normalized}"))),
    }
}

fn parse_legacy_credit_card_csv(content: &str) -> Result<ParsedCreditCardInvoice, AppError> {
    let mut reader = ReaderBuilder::new().delimiter(b';').flexible(false).from_reader(strip_bom(content).as_bytes());
    let mut items = Vec::new();
    for (row, record) in reader.records().enumerate() {
        let record = record.map_err(|e| AppError::Validation(e.to_string()))?;
        let description = record.get(1).unwrap_or("").trim().to_string();
        if description.is_empty() {
            return Err(AppError::Validation(format!("Estabelecimento ausente na linha {}", row + 2)));
        }
        let raw_amount = parse_brl(record.get(3).unwrap_or(""))?;
        let normalized_description = normalize_description(&description);
        let is_payment = normalized_description.contains("PAGAMENTO DE FATURA");
        items.push(CreditCardImportItem {
            candidate: ImportCandidate {
                source_row: row + 2,
                date: parse_date(record.get(0).unwrap_or(""))?,
                description,
                normalized_description,
                amount_in_cents: -raw_amount,
                external_id: None,
                suggested_category_id: None,
                suggested_category_name: None,
                suggested_rule_id: None,
                suggested_rule_name: None,
                duplicate_status: DuplicateStatus::New,
                warnings: vec![],
                included: true,
            },
            holder: record.get(2).map(str::trim).filter(|value| !value.is_empty()).map(String::from),
            installment: record.get(4).map(str::trim).filter(|value| !value.is_empty() && *value != "-").map(String::from),
            raw_amount_in_cents: raw_amount,
            included: true,
            is_payment,
        });
    }
    if items.is_empty() {
        return Err(AppError::Validation("A fatura não contém lançamentos".into()));
    }
    Ok(ParsedCreditCardInvoice { due_date: None, items })
}

fn parse_sicoob_pdf(path: &Path) -> Result<Vec<ImportCandidate>, AppError> {
    const MAX_PDF_SIZE: u64 = 15 * 1024 * 1024;
    if fs::metadata(path)?.len() > MAX_PDF_SIZE {
        return Err(AppError::Validation("O PDF excede o limite de 15 MB".into()));
    }
    let bytes = fs::read(path)?;
    if !bytes.starts_with(b"%PDF-") {
        return Err(AppError::Validation("O arquivo não contém um PDF válido".into()));
    }
    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| AppError::Pdf(e.to_string()))?;
    if !text.to_uppercase().contains("SICOOB") || !text.to_uppercase().contains("EXTRATO CONTA CORRENTE") {
        return Err(AppError::Validation("Este PDF não corresponde ao extrato de conta corrente do Sicoob".into()));
    }
    parse_sicoob_text(&text)
}

#[derive(Default)]
struct SicoobRow {
    source_row: usize,
    day: u32,
    month: u32,
    description: String,
    amount: Option<i64>,
    direction: Option<char>,
    ignored: bool,
}

fn parse_sicoob_text(text: &str) -> Result<Vec<ImportCandidate>, AppError> {
    let period = Regex::new(r"(?i)PER[ÍI]ODO:\s*\d{2}/\d{2}/(\d{4})\s*-\s*\d{2}/(\d{2})/(\d{4})").unwrap();
    let captures = period.captures(text).ok_or_else(|| AppError::Validation("Período do extrato Sicoob não encontrado".into()))?;
    let end_month: u32 = captures[2].parse().unwrap_or(12);
    let end_year: i32 = captures[3].parse().map_err(|_| AppError::Validation("Ano do extrato inválido".into()))?;
    let date_line = Regex::new(r"^\s*(\d{2})/(\d{2})\s+(.+?)\s*$").unwrap();
    let money = Regex::new(r"(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])?\s*$").unwrap();
    let sensitive = Regex::new(r"(?i)^(DOC\.?:|C[ÓO]DIGO TED:)|(?:\*{2,}|\d{3}[.\s]\d{3}[.\s]\d{3}|\d{2}[.\s]\d{3}[.\s]\d{3})").unwrap();
    let mut result = Vec::new();
    let mut current: Option<SicoobRow> = None;
    let mut in_history = false;

    let finish = |row: SicoobRow, result: &mut Vec<ImportCandidate>| -> Result<(), AppError> {
        if row.ignored { return Ok(()); }
        let (amount, direction) = match (row.amount, row.direction) {
            (Some(amount), Some(direction)) => (amount, direction),
            _ => return Ok(()),
        };
        let year = if row.month > end_month { end_year - 1 } else { end_year };
        let date = NaiveDate::from_ymd_opt(year, row.month, row.day)
            .ok_or_else(|| AppError::Validation("Data inválida em lançamento do Sicoob".into()))?;
        let description = row.description.trim().to_string();
        result.push(ImportCandidate {
            source_row: row.source_row,
            date: date.format("%Y-%m-%d").to_string(),
            normalized_description: normalize_description(&description),
            description,
            amount_in_cents: if direction == 'D' { -amount } else { amount },
            external_id: None,
            suggested_category_id: None,
            suggested_category_name: None,
            suggested_rule_id: None,
            suggested_rule_name: None,
            duplicate_status: DuplicateStatus::New,
            warnings: vec!["Importado de PDF textual do Sicoob; confira a prévia antes de confirmar.".into()],
            included: true,
        });
        Ok(())
    };

    for (index, raw) in text.lines().enumerate() {
        let line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.to_uppercase().contains("HISTÓRICO DE MOVIMENTAÇÃO") || line.to_uppercase().contains("HISTORICO DE MOVIMENTACAO") {
            in_history = true;
            continue;
        }
        if !in_history || line.is_empty() { continue; }
        if line == "RESUMO" || line.starts_with("(+) SALDO EM CONTA") {
            if let Some(row) = current.take() { finish(row, &mut result)?; }
            break;
        }
        if let Some(c) = date_line.captures(&line) {
            if let Some(row) = current.take() { finish(row, &mut result)?; }
            let mut rest = c[3].to_string();
            let mut amount = None;
            let mut direction = None;
            if let Some(m) = money.captures(&rest) {
                amount = Some(parse_brl(&m[1])?.unsigned_abs() as i64);
                direction = m.get(2).and_then(|x| x.as_str().chars().next());
                rest = rest[..m.get(0).unwrap().start()].trim().to_string();
            }
            let upper = rest.to_uppercase();
            current = Some(SicoobRow {
                source_row: index + 1,
                day: c[1].parse().unwrap_or(0),
                month: c[2].parse().unwrap_or(0),
                description: rest,
                amount,
                direction,
                ignored: upper.contains("SALDO") || upper.contains("BLOQ."),
            });
            continue;
        }
        if let Some(row) = current.as_mut() {
            if row.amount.is_none() {
                if let Some(m) = money.captures(&line) {
                    row.amount = Some(parse_brl(&m[1])?.unsigned_abs() as i64);
                    row.direction = m.get(2).and_then(|x| x.as_str().chars().next());
                    continue;
                }
            }
            if row.direction.is_none() && (line == "C" || line == "D") {
                row.direction = line.chars().next();
                continue;
            }
            let upper = line.to_uppercase();
            if !row.ignored
                && !sensitive.is_match(&line)
                && !upper.starts_with("PAGAMENTO PIX")
                && !upper.starts_with("RECEBIMENTO PIX")
                && !upper.starts_with("DATA HISTÓRICO")
                && !upper.starts_with("DATA HISTORICO")
            {
                if !row.description.is_empty() { row.description.push_str(" - "); }
                row.description.push_str(&line);
            }
        }
    }
    if let Some(row) = current { finish(row, &mut result)?; }
    if result.is_empty() {
        return Err(AppError::Validation("Nenhum lançamento reconhecido neste PDF do Sicoob".into()));
    }
    Ok(result)
}

fn parse_ofx(content: &str) -> Result<Vec<ImportCandidate>, AppError> {
    let tag = |block: &str, name: &str| -> Option<String> {
        let start = block.find(&format!("<{name}>"))? + name.len() + 2;
        let rest = &block[start..];
        let end = rest.find(['<', '\r', '\n']).unwrap_or(rest.len());
        Some(rest[..end].trim().to_string())
    };
    content.split("<STMTTRN>").skip(1).enumerate().map(|(row, block)| {
        let raw_date = tag(block, "DTPOSTED").ok_or_else(|| AppError::Validation("OFX sem data".into()))?;
        let date = NaiveDate::parse_from_str(&raw_date[..8.min(raw_date.len())], "%Y%m%d")
            .map_err(|_| AppError::Validation("Data OFX inválida".into()))?;
        let description = tag(block, "MEMO").or_else(|| tag(block, "NAME")).unwrap_or_else(|| "Sem descrição".into());
        Ok(ImportCandidate {
            source_row: row + 1,
            date: date.format("%Y-%m-%d").to_string(),
            normalized_description: normalize_description(&description),
            description,
            amount_in_cents: parse_brl(&tag(block, "TRNAMT").ok_or_else(|| AppError::Validation("OFX sem valor".into()))?)?,
            external_id: tag(block, "FITID"),
            suggested_category_id: None,
            suggested_category_name: None,
            suggested_rule_id: None,
            suggested_rule_name: None,
            duplicate_status: DuplicateStatus::New,
            warnings: vec![],
            included: true,
        })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::import::{CsvColumnMapping, CsvColumnRole, CsvMappingDraft, ImportSourceKind};

    #[test]
    fn detects_unknown_and_known_csvs() {
        assert_eq!(detect_csv_kind("date,description,amount\n2026-06-01,Salario,1000").unwrap(), DetectedImportKind::KnownBank);
        assert_eq!(
            detect_csv_kind("Data;Estabelecimento;Portador;Valor;Parcela\n01/05/2026;Loja;Ana;100,00;1/2").unwrap(),
            DetectedImportKind::KnownCreditCard
        );
        assert_eq!(detect_csv_kind("coluna_a;coluna_b\nx;y").unwrap(), DetectedImportKind::UnknownCsv);
    }

    #[test]
    fn maps_bank_csv_with_separate_debit_and_credit() {
        let mapping = CsvMappingDraft {
            source_kind: ImportSourceKind::Bank,
            delimiter: ";".into(),
            date_format: Some("dd/MM/yyyy".into()),
            decimal_separator: Some("comma".into()),
            default_due_date: None,
            profile_name: None,
            columns: vec![
                CsvColumnMapping { index: 0, header: "Data".into(), role: CsvColumnRole::Date },
                CsvColumnMapping { index: 1, header: "Historico".into(), role: CsvColumnRole::Description },
                CsvColumnMapping { index: 2, header: "Debito".into(), role: CsvColumnRole::DebitAmount },
                CsvColumnMapping { index: 3, header: "Credito".into(), role: CsvColumnRole::CreditAmount },
            ],
        };
        let rows = read_csv_rows("Data;Historico;Debito;Credito\n01/06/2026;Mercado;50,00;\n02/06/2026;Salario;;1200,00", b';').unwrap();
        let parsed = parse_mapped_bank_rows(rows, &mapping).unwrap();
        assert_eq!(parsed[0].amount_in_cents, -5_000);
        assert_eq!(parsed[1].amount_in_cents, 120_000);
    }

    #[test]
    fn maps_credit_card_csv_with_row_kind() {
        let mapping = CsvMappingDraft {
            source_kind: ImportSourceKind::CreditCard,
            delimiter: ";".into(),
            date_format: Some("dd/MM/yyyy".into()),
            decimal_separator: Some("comma".into()),
            default_due_date: Some("2026-06-10".into()),
            profile_name: None,
            columns: vec![
                CsvColumnMapping { index: 0, header: "Data".into(), role: CsvColumnRole::PurchaseDate },
                CsvColumnMapping { index: 1, header: "Descricao".into(), role: CsvColumnRole::Description },
                CsvColumnMapping { index: 2, header: "Valor".into(), role: CsvColumnRole::SignedAmount },
                CsvColumnMapping { index: 3, header: "Tipo".into(), role: CsvColumnRole::RowKind },
            ],
        };
        let rows = read_csv_rows("Data;Descricao;Valor;Tipo\n01/05/2026;Supermercado;100,00;purchase\n05/05/2026;Pagamento;100,00;payment", b';').unwrap();
        let invoice = parse_mapped_credit_card_rows(rows, &mapping).unwrap();
        assert_eq!(invoice.due_date.as_deref(), Some("2026-06-10"));
        assert_eq!(invoice.items[0].candidate.amount_in_cents, -10_000);
        assert_eq!(invoice.items[1].candidate.amount_in_cents, 10_000);
        assert!(invoice.items[1].is_payment);
    }

    #[test]
    fn parses_sicoob_text_and_ignores_balances() {
        let text = r#"
SICOOB
EXTRATO CONTA CORRENTE
PERÍODO: 01/05/2026 - 31/05/2026
HISTÓRICO DE MOVIMENTAÇÃO
DATA HISTÓRICO VALOR
30/04 SALDO ANTERIOR 6.666,10C
04/05 PIX RECEB.OUTRA IF 20,50C
Recebimento Pix
CLIENTE EXEMPLO
***.178.766-**
04/05 DEB PACOTE SERVIÇOS 11,45D
04/05 SALDO DO DIA 8.675,15C
RESUMO
(+) SALDO EM CONTA: 8.675,15C
"#;
        let rows = parse_sicoob_text(text).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].date, "2026-05-04");
        assert_eq!(rows[0].amount_in_cents, 2050);
        assert!(rows[0].description.contains("CLIENTE EXEMPLO"));
        assert!(!rows[0].description.contains("***"));
        assert_eq!(rows[1].amount_in_cents, -1145);
    }

    #[test]
    fn parses_credit_card_invoice_and_inverts_signs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Fatura2026-06-10.csv");
        fs::write(&path, concat!(
            "Data;Estabelecimento;Portador;Valor;Parcela\n",
            "01/05/2026;SUPERMERCADO;JOAO;R$ 100,00;-\n",
            "05/05/2026;Pagamento de fatura;JOAO;R$ -80,00; de 1\n"
        )).unwrap();
        let invoice = parse_credit_card_csv(&path).unwrap();
        assert_eq!(invoice.items[0].candidate.amount_in_cents, -10000);
        assert_eq!(invoice.items[1].candidate.amount_in_cents, 8000);
        assert!(invoice.items[1].is_payment);
        assert_eq!(invoice.items[1].installment.as_deref(), Some("de 1"));
    }
}
