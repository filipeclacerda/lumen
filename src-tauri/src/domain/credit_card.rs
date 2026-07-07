use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::import::ImportCandidate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreditCardLineKind {
    Purchase,
    Refund,
    Payment,
}

impl CreditCardLineKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Purchase => "purchase",
            Self::Refund => "refund",
            Self::Payment => "payment",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "purchase" => Some(Self::Purchase),
            "refund" => Some(Self::Refund),
            "payment" => Some(Self::Payment),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditCardImportItem {
    pub candidate: ImportCandidate,
    pub holder: Option<String>,
    pub installment: Option<String>,
    pub raw_amount_in_cents: i64,
    pub line_kind: CreditCardLineKind,
    pub included: bool,
    pub is_payment: bool,
}

impl CreditCardImportItem {
    pub fn new(
        candidate: ImportCandidate,
        holder: Option<String>,
        installment: Option<String>,
        raw_amount_in_cents: i64,
        line_kind: CreditCardLineKind,
    ) -> Self {
        Self {
            candidate,
            holder,
            installment,
            raw_amount_in_cents,
            line_kind,
            included: true,
            is_payment: line_kind == CreditCardLineKind::Payment,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParsedCreditCardInvoice {
    pub due_date: Option<String>,
    pub items: Vec<CreditCardImportItem>,
}

pub struct CreditCardInvoiceTotals {
    pub purchases_in_cents: i64,
    pub credits_in_cents: i64,
    pub total_in_cents: i64,
}

pub fn totals(items: &[CreditCardImportItem]) -> CreditCardInvoiceTotals {
    let purchases = items
        .iter()
        .filter(|item| item.included && item.line_kind == CreditCardLineKind::Purchase)
        .map(|item| item.raw_amount_in_cents.abs())
        .sum();
    let credits = items
        .iter()
        .filter(|item| item.included && item.line_kind != CreditCardLineKind::Purchase)
        .map(|item| item.raw_amount_in_cents.abs())
        .sum();
    CreditCardInvoiceTotals {
        purchases_in_cents: purchases,
        credits_in_cents: credits,
        total_in_cents: purchases - credits,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::import::{DuplicateStatus, ImportCandidate};

    fn item(
        amount: i64,
        raw: i64,
        line_kind: CreditCardLineKind,
        included: bool,
    ) -> CreditCardImportItem {
        let mut item = CreditCardImportItem::new(
            ImportCandidate {
                source_row: 1,
                date: "2026-06-01".into(),
                description: "Teste".into(),
                normalized_description: "TESTE".into(),
                amount_in_cents: amount,
                external_id: None,
                suggested_category_id: None,
                suggested_category_name: None,
                suggested_rule_id: None,
                suggested_rule_name: None,
                suggestion_source: None,
                duplicate_status: DuplicateStatus::New,
                warnings: vec![],
                included,
            },
            None,
            None,
            raw,
            line_kind,
        );
        item.included = included;
        item
    }

    #[test]
    fn totals_keep_card_sign_convention_explicit() {
        let totals = totals(&[
            item(-10_000, 10_000, CreditCardLineKind::Purchase, true),
            item(2_000, -2_000, CreditCardLineKind::Refund, true),
            item(5_000, -5_000, CreditCardLineKind::Payment, true),
            item(-999, 999, CreditCardLineKind::Purchase, false),
        ]);
        assert_eq!(totals.purchases_in_cents, 10_000);
        assert_eq!(totals.credits_in_cents, 7_000);
        assert_eq!(totals.total_in_cents, 3_000);
    }
}
