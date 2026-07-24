use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub source_row: usize,
    pub date: String,
    pub description: String,
    pub normalized_description: String,
    #[serde(default)]
    pub is_pix: bool,
    #[serde(default)]
    pub is_own_account_pix: bool,
    #[serde(default)]
    pub needs_merchant_identification: bool,
    pub amount_in_cents: i64,
    pub external_id: Option<String>,
    pub suggested_category_id: Option<String>,
    pub suggested_category_name: Option<String>,
    pub suggested_rule_id: Option<String>,
    pub suggested_rule_name: Option<String>,
    pub suggestion_source: Option<SuggestionSource>,
    pub merchant_key: String,
    pub category_suggestions: Vec<CategorySuggestion>,
    pub duplicate_status: DuplicateStatus,
    pub warnings: Vec<String>,
    pub included: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategorySuggestion {
    pub category_id: String,
    pub category_name: String,
    pub source: CategorySuggestionSource,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CategorySuggestionSource {
    SimilarHistory,
    Vocabulary,
    CategoryName,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionSource {
    Rule,
    History,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DuplicateStatus {
    New,
    Probable,
    Exact,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportSourceKind {
    Bank,
    CreditCard,
}

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
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
}

pub fn is_pix_description(value: &str) -> bool {
    value
        .split(|character: char| !character.is_alphanumeric())
        .any(|token| token.eq_ignore_ascii_case("pix"))
}

pub fn is_own_account_pix_description(value: &str) -> bool {
    if !is_pix_description(value) {
        return false;
    }
    let tokens = value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_uppercase())
        .collect::<Vec<_>>();
    tokens.windows(2).any(|pair| {
        matches!(
            pair,
            [left, right]
                if (left == "IF" && right == "MSM")
                    || (left == "MESMA" && right == "TITULARIDADE")
                    || (left == "MESMO" && right == "TITULAR")
        )
    })
}

/// PIX descriptions are not structured counterparty identifiers. Until an importer
/// exposes a bank-provided identity field, every third-party PIX requires explicit
/// confirmation; own-account PIX remains handled by the transfer flow.
pub fn needs_pix_merchant_identification(value: &str) -> bool {
    is_pix_description(value) && !is_own_account_pix_description(value)
}

pub fn mapping_signature(
    headers: &[String],
    delimiter: &str,
    source_kind: ImportSourceKind,
) -> String {
    let normalized_headers = headers
        .iter()
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
    let input = format!(
        "{}|{}|{}|{}",
        account_id, candidate.date, candidate.amount_in_cents, candidate.normalized_description
    );
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptions_are_stable() {
        assert_eq!(normalize_description("  Café   Central "), "CAFÉ CENTRAL");
    }

    #[test]
    fn detects_pix_as_a_standalone_token() {
        for description in [
            "PIX RECEBIDO",
            "Pagamento Pix - Maria",
            "PIX_QRS JOAO DA SILVA",
            "transferência/pix",
        ] {
            assert!(
                is_pix_description(description),
                "expected PIX in {description:?}"
            );
        }
    }

    #[test]
    fn does_not_detect_pix_inside_another_word() {
        for description in ["PIXEL DESIGN", "COMPRA PIXAR", "CHAVEPIX", "PICPAY"] {
            assert!(
                !is_pix_description(description),
                "did not expect PIX in {description:?}"
            );
        }
    }

    #[test]
    fn detects_pix_sent_to_an_account_with_the_same_ownership() {
        for description in [
            "PIX.EMIT.OUT IF-MSM",
            "PIX IF MSM",
            "Pagamento PIX mesma titularidade",
            "PIX para mesmo titular",
        ] {
            assert!(
                is_own_account_pix_description(description),
                "expected an own-account PIX in {description:?}"
            );
        }
        for description in [
            "PIX EMIT OUTRA IF",
            "PIX MARIA SILVA",
            "IF-MSM SEM TRANSFERENCIA",
        ] {
            assert!(
                !is_own_account_pix_description(description),
                "did not expect an own-account PIX in {description:?}"
            );
        }
    }

    #[test]
    fn flags_only_pix_without_a_distinctive_counterparty() {
        for description in [
            "Pix emitido outra IF",
            "PIX.EMIT.OUT IF",
            "Pix recebido",
            "PIX - transferência",
            "Pix emitido outra IF 123456",
            "PIX enviado 24/07/2026",
            "PIX recebido E2E 123456789",
            "PIX DEVOLUÇÃO",
            "PIX AGENDADO",
            "PIX CRÉDITO",
            "PIX DÉBITO",
            "PIX IFOOD",
            "Pix emitido outra IF JOAO SILVA",
            "PIX QRS MERCADO CENTRAL",
        ] {
            assert!(
                needs_pix_merchant_identification(description),
                "expected unidentified PIX in {description:?}"
            );
        }
        for description in ["PIX IF-MSM", "Compra no PIXEL DESIGN"] {
            assert!(
                !needs_pix_merchant_identification(description),
                "did not expect unidentified PIX in {description:?}"
            );
        }
    }
}
