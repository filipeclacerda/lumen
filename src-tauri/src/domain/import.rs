use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub source_row: usize,
    pub date: String,
    pub description: String,
    pub normalized_description: String,
    pub amount_in_cents: i64,
    pub external_id: Option<String>,
    pub suggested_category_id: Option<String>,
    pub suggested_category_name: Option<String>,
    pub suggested_rule_id: Option<String>,
    pub suggested_rule_name: Option<String>,
    pub duplicate_status: DuplicateStatus,
    pub warnings: Vec<String>,
    pub included: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DuplicateStatus { New, Probable, Exact }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportSourceKind { Bank, CreditCard }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CsvColumnRole {
    Ignore,
    Date,
    Description,
    SignedAmount,
    DebitAmount,
    CreditAmount,
    ExternalId,
    Balance,
    PurchaseDate,
    Holder,
    Installment,
    RowKind,
    DueDate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvColumnMapping {
    pub index: usize,
    pub header: String,
    pub role: CsvColumnRole,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvMappingDraft {
    pub source_kind: ImportSourceKind,
    pub delimiter: String,
    pub date_format: Option<String>,
    pub decimal_separator: Option<String>,
    pub default_due_date: Option<String>,
    pub profile_name: Option<String>,
    pub columns: Vec<CsvColumnMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvMappingProfile {
    pub id: String,
    pub name: String,
    pub source_kind: ImportSourceKind,
    pub delimiter: String,
    pub date_format: Option<String>,
    pub decimal_separator: Option<String>,
    pub signature: String,
    pub columns: Vec<CsvColumnMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedImportRow {
    pub source_row: usize,
    pub source_kind: ImportSourceKind,
    pub date: String,
    pub description: String,
    pub amount_in_cents: i64,
    pub external_id: Option<String>,
    pub row_kind: Option<String>,
    pub holder: Option<String>,
    pub installment: Option<String>,
    pub due_date: Option<String>,
    pub warnings: Vec<String>,
}

pub fn normalize_description(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_uppercase()
}

pub fn mapping_signature(headers: &[String], delimiter: &str, source_kind: ImportSourceKind) -> String {
    let normalized_headers = headers.iter()
        .map(|header| header.trim().to_lowercase())
        .collect::<Vec<_>>()
        .join("|");
    let kind = match source_kind {
        ImportSourceKind::Bank => "bank",
        ImportSourceKind::CreditCard => "credit_card",
    };
    let input = format!("{kind}|{delimiter}|{normalized_headers}");
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

pub fn fingerprint(account_id: &str, candidate: &ImportCandidate) -> String {
    let input = format!("{}|{}|{}|{}", account_id, candidate.date, candidate.amount_in_cents, candidate.normalized_description);
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn descriptions_are_stable() {
        assert_eq!(normalize_description("  Café   Central "), "CAFÉ CENTRAL");
    }
}
