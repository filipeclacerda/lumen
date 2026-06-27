use std::{fs, path::Path};
use chrono::NaiveDate;
use regex::Regex;
use crate::{domain::{import::{normalize_description, DuplicateStatus, ImportCandidate}, money::parse_brl}, error::AppError};

pub fn parse_file(path: &Path) -> Result<Vec<ImportCandidate>, AppError> {
    match path.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase().as_str() {
        "csv" => parse_csv(&fs::read_to_string(path)?),
        "ofx" => parse_ofx(&fs::read_to_string(path)?),
        "pdf" => parse_sicoob_pdf(path),
        _ => Err(AppError::UnsupportedFormat)
    }
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

fn parse_date(value: &str) -> Result<String, AppError> {
    for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"] {
        if let Ok(date) = NaiveDate::parse_from_str(value.trim(), fmt) { return Ok(date.format("%Y-%m-%d").to_string()); }
    }
    Err(AppError::Validation(format!("Data inválida: {value}")))
}

fn parse_csv(content: &str) -> Result<Vec<ImportCandidate>, AppError> {
    let delimiter = if content.lines().next().unwrap_or("").matches(';').count() > content.lines().next().unwrap_or("").matches(',').count() { b';' } else { b',' };
    let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).flexible(true).from_reader(content.as_bytes());
    let headers = reader.headers().map_err(|e| AppError::Validation(e.to_string()))?.clone();
    let index = |names: &[&str]| headers.iter().position(|h| names.iter().any(|n| h.trim().to_lowercase().contains(n)));
    let date_i = index(&["data", "date"]).ok_or_else(|| AppError::Validation("Coluna de data ausente".into()))?;
    let desc_i = index(&["descr", "hist", "memo"]).ok_or_else(|| AppError::Validation("Coluna de descrição ausente".into()))?;
    let amount_i = index(&["valor", "amount"]).ok_or_else(|| AppError::Validation("Coluna de valor ausente".into()))?;
    let id_i = index(&["id", "documento", "fitid"]);
    reader.records().enumerate().map(|(row, record)| {
        let record = record.map_err(|e| AppError::Validation(e.to_string()))?;
        let description = record.get(desc_i).unwrap_or("").trim().to_string();
        Ok(ImportCandidate {
            source_row: row + 2, date: parse_date(record.get(date_i).unwrap_or(""))?,
            normalized_description: normalize_description(&description), description,
            amount_in_cents: parse_brl(record.get(amount_i).unwrap_or(""))?,
            external_id: id_i.and_then(|i| record.get(i)).filter(|x| !x.is_empty()).map(String::from),
            suggested_category_id: None, suggested_category_name: None,
            suggested_rule_id: None, suggested_rule_name: None,
            duplicate_status: DuplicateStatus::New, warnings: vec![]
        })
    }).collect()
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
        let date = NaiveDate::parse_from_str(&raw_date[..8.min(raw_date.len())], "%Y%m%d").map_err(|_| AppError::Validation("Data OFX inválida".into()))?;
        let description = tag(block, "MEMO").or_else(|| tag(block, "NAME")).unwrap_or_else(|| "Sem descrição".into());
        Ok(ImportCandidate { source_row: row + 1, date: date.format("%Y-%m-%d").to_string(),
            normalized_description: normalize_description(&description), description,
            amount_in_cents: parse_brl(&tag(block, "TRNAMT").ok_or_else(|| AppError::Validation("OFX sem valor".into()))?)?,
            external_id: tag(block, "FITID"), suggested_category_id: None,
            suggested_category_name: None, suggested_rule_id: None, suggested_rule_name: None,
            duplicate_status: DuplicateStatus::New, warnings: vec![] })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sicoob_text_and_ignores_balances() {
        let text = r#"
SICOOB
EXTRATO CONTA CORRENTE
PERÍODO: 01/05/2026 - 31/05/2026
HISTÓRICO DE MOVIMENTAÇÃO
DATA HISTÓRICO VALOR
30/04 SALDO ANTERIOR 8.666,10C
04/05 PIX RECEB.OUTRA IF 20,50C
Recebimento Pix
CLIENTE EXEMPLO
***.178.766-**
DOC.: Pix
04/05 DEB PACOTE SERVIÇOS 11,45D
DOC.: 129
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
    fn parses_real_sicoob_fixture_when_configured() {
        let Ok(path) = std::env::var("SICOOB_TEST_PDF") else { return };
        let rows = parse_sicoob_pdf(Path::new(&path)).unwrap();
        assert_eq!(rows.len(), 14);
        assert!(rows.iter().all(|row| row.amount_in_cents != 0));
        assert!(rows.iter().all(|row| !row.description.to_uppercase().contains("SALDO")));
    }
}
