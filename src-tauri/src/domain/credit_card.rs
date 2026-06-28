use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::import::ImportCandidate;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardImportItem {
    pub candidate: ImportCandidate,
    pub holder: Option<String>,
    pub installment: Option<String>,
    pub raw_amount_in_cents: i64,
    pub included: bool,
    pub is_payment: bool,
}

#[derive(Debug, Clone)]
pub struct ParsedCreditCardInvoice {
    pub due_date: Option<String>,
    pub items: Vec<CreditCardImportItem>,
}

pub fn item_fingerprint(account_id: &str, item: &CreditCardImportItem) -> String {
    let input = format!(
        "card|{}|{}|{}|{}|{}|{}",
        account_id,
        item.candidate.date,
        item.candidate.normalized_description,
        item.candidate.amount_in_cents,
        item.holder.as_deref().unwrap_or(""),
        item.installment.as_deref().unwrap_or("")
    );
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

