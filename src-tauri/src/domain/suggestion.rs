/// A merchant needs at least this many categorized occurrences of the winning category before
/// we trust it enough to suggest it automatically on a brand new import.
pub const MIN_OCCURRENCES: i64 = 2;
/// The winning category must hold at least this share of the merchant's categorized history;
/// below this, the user visibly oscillates between categories and a suggestion would be noise
/// that erodes trust rather than saving time.
pub const MIN_DOMINANCE_PERCENT: f64 = 70.0;

/// Per-category aggregate for a single merchant, as fetched in one batched query
/// (see `commands::suggest_categories_from_history`).
#[derive(Debug, Clone)]
pub struct MerchantCategoryStat {
    pub category_id: String,
    pub category_name: Option<String>,
    pub category_kind: String,
    pub count: i64,
    pub last_used: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HistorySuggestion {
    pub category_id: String,
    pub category_name: Option<String>,
}

/// A category's kind constrains which transaction sign it can plausibly apply to
/// (e.g. never suggest an expense category for a credit/refund).
fn amount_compatible(category_kind: &str, amount_in_cents: i64) -> bool {
    match category_kind {
        "income" => amount_in_cents > 0,
        "expense" | "investment" => amount_in_cents < 0,
        _ => true,
    }
}

/// Decides whether a merchant's categorization history is confident enough to suggest a
/// category automatically. Only called for candidates that no explicit rule already matched —
/// regra explícita sempre vence histórico (ADR, PLANO_FASE3.md Etapa 2).
pub fn suggest_from_history(
    stats: &[MerchantCategoryStat],
    amount_in_cents: i64,
) -> Option<HistorySuggestion> {
    if stats.is_empty() {
        return None;
    }
    let total: i64 = stats.iter().map(|s| s.count).sum();
    let top = stats.iter().max_by(|a, b| {
        a.count
            .cmp(&b.count)
            .then_with(|| a.last_used.cmp(&b.last_used))
    })?;
    if top.count < MIN_OCCURRENCES {
        return None;
    }
    let dominance = top.count as f64 / total as f64 * 100.0;
    if dominance < MIN_DOMINANCE_PERCENT {
        return None;
    }
    if !amount_compatible(&top.category_kind, amount_in_cents) {
        return None;
    }
    Some(HistorySuggestion {
        category_id: top.category_id.clone(),
        category_name: top.category_name.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(category_id: &str, kind: &str, count: i64, last_used: &str) -> MerchantCategoryStat {
        MerchantCategoryStat {
            category_id: category_id.into(),
            category_name: Some(category_id.into()),
            category_kind: kind.into(),
            count,
            last_used: last_used.into(),
        }
    }

    #[test]
    fn suggests_when_dominant_and_frequent_enough() {
        let stats = vec![stat("groceries", "expense", 3, "2026-06-01")];
        assert_eq!(
            suggest_from_history(&stats, -5000).unwrap().category_id,
            "groceries"
        );
    }

    #[test]
    fn refuses_below_minimum_occurrences() {
        let stats = vec![stat("groceries", "expense", 1, "2026-06-01")];
        assert!(suggest_from_history(&stats, -5000).is_none());
    }

    #[test]
    fn refuses_when_history_is_split_between_categories() {
        // 3 vs 2 => 60% dominance, below the 70% threshold.
        let stats = vec![
            stat("groceries", "expense", 3, "2026-06-01"),
            stat("dining", "expense", 2, "2026-06-05"),
        ];
        assert!(suggest_from_history(&stats, -5000).is_none());
    }

    #[test]
    fn refuses_when_sign_is_incompatible_with_category_kind() {
        let stats = vec![stat("groceries", "expense", 3, "2026-06-01")];
        assert!(
            suggest_from_history(&stats, 5000).is_none(),
            "credit should not get an expense suggestion"
        );
    }

    #[test]
    fn refuses_for_unseen_merchant() {
        assert!(suggest_from_history(&[], -5000).is_none());
    }

    #[test]
    fn income_requires_positive_amount() {
        let stats = vec![stat("salary", "income", 2, "2026-06-01")];
        assert!(suggest_from_history(&stats, -5000).is_none());
        assert!(suggest_from_history(&stats, 5000).is_some());
    }
}
