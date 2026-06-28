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

pub fn normalize_description(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_uppercase()
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
