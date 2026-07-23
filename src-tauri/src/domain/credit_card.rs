use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

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
    pub payments_in_cents: i64,
    pub total_in_cents: i64,
}

pub fn totals(
    items: &[CreditCardImportItem],
) -> Result<CreditCardInvoiceTotals, crate::error::AppError> {
    let mut purchases = 0i64;
    let mut credits = 0i64;
    let mut payments = 0i64;
    for item in items.iter().filter(|item| item.included) {
        let amount = item
            .raw_amount_in_cents
            .checked_abs()
            .ok_or_else(|| crate::error::AppError::Validation("Total da fatura inválido".into()))?;
        match item.line_kind {
            CreditCardLineKind::Purchase => {
                purchases = purchases.checked_add(amount).ok_or_else(|| {
                    crate::error::AppError::Validation("Total da fatura inválido".into())
                })?;
            }
            CreditCardLineKind::Refund => {
                credits = credits.checked_add(amount).ok_or_else(|| {
                    crate::error::AppError::Validation("Total da fatura inválido".into())
                })?;
            }
            CreditCardLineKind::Payment => {
                payments = payments.checked_add(amount).ok_or_else(|| {
                    crate::error::AppError::Validation("Total da fatura inválido".into())
                })?;
            }
        }
    }
    let total = purchases
        .checked_sub(credits)
        .ok_or_else(|| crate::error::AppError::Validation("Total da fatura inválido".into()))?;
    Ok(CreditCardInvoiceTotals {
        purchases_in_cents: purchases,
        credits_in_cents: credits,
        payments_in_cents: payments,
        total_in_cents: total,
    })
}

pub fn mark_intra_file_duplicates(account_id: &str, items: &mut [CreditCardImportItem]) {
    let mut external_ids = HashSet::new();
    let mut fingerprints = HashSet::new();
    for item in items {
        let duplicate = if let Some(id) = item
            .candidate
            .external_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            !external_ids.insert(id.to_owned())
        } else {
            !fingerprints.insert(item_fingerprint(account_id, item))
        };
        if duplicate {
            item.candidate.duplicate_status = crate::domain::import::DuplicateStatus::Exact;
            item.included = false;
        }
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
                is_pix: false,
                is_own_account_pix: false,
                amount_in_cents: amount,
                external_id: None,
                suggested_category_id: None,
                suggested_category_name: None,
                suggested_rule_id: None,
                suggested_rule_name: None,
                suggestion_source: None,
                merchant_key: String::new(),
                category_suggestions: vec![],
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
    fn intra_file_dedupe_prefers_external_id_and_fingerprint_fallback() {
        let mut first = item(-100, 100, CreditCardLineKind::Purchase, true);
        let mut second = first.clone();
        first.candidate.external_id = Some(" id-1 ".into());
        second.candidate.external_id = Some("id-1".into());
        let mut external_items = vec![first.clone(), second.clone()];
        mark_intra_file_duplicates("account", &mut external_items);
        assert!(external_items[0].included);
        assert!(!external_items[1].included);
        let mut items = vec![first, second];
        items[0].candidate.external_id = None;
        items[1].candidate.external_id = None;
        mark_intra_file_duplicates("account", &mut items);
        assert!(items[0].included);
        assert!(!items[1].included);
    }

    #[test]
    fn totals_rejects_min_value_and_overflow() {
        assert!(totals(&[item(0, i64::MIN, CreditCardLineKind::Purchase, true)]).is_err());
        assert!(totals(&[
            item(0, i64::MAX, CreditCardLineKind::Purchase, true),
            item(0, i64::MAX, CreditCardLineKind::Purchase, true),
        ])
        .is_err());
        assert!(totals(&[
            item(0, i64::MAX, CreditCardLineKind::Payment, true),
            item(0, i64::MAX, CreditCardLineKind::Payment, true),
        ])
        .is_err());
    }

    #[test]
    fn totals_keep_card_sign_convention_explicit() {
        let totals = totals(&[
            item(-10_000, 10_000, CreditCardLineKind::Purchase, true),
            item(2_000, -2_000, CreditCardLineKind::Refund, true),
            item(5_000, -5_000, CreditCardLineKind::Payment, true),
            item(-999, 999, CreditCardLineKind::Purchase, false),
        ])
        .unwrap();
        assert_eq!(totals.purchases_in_cents, 10_000);
        assert_eq!(totals.credits_in_cents, 2_000);
        assert_eq!(totals.payments_in_cents, 5_000);
        assert_eq!(totals.total_in_cents, 8_000);
    }

    #[test]
    fn payment_does_not_change_current_invoice_total() {
        let totals = totals(&[
            item(-10_000, 10_000, CreditCardLineKind::Purchase, true),
            item(2_000, -2_000, CreditCardLineKind::Refund, true),
            item(5_000, -5_000, CreditCardLineKind::Payment, true),
        ])
        .unwrap();

        assert_eq!(totals.purchases_in_cents, 10_000);
        assert_eq!(totals.credits_in_cents, 2_000);
        assert_eq!(totals.payments_in_cents, 5_000);
        assert_eq!(totals.total_in_cents, 8_000);
    }
}
