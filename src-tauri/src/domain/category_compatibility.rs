/// Semantic kinds persisted by categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CategoryKind {
    Income,
    Expense,
    Transfer,
    Investment,
}

impl CategoryKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "income" => Some(Self::Income),
            "expense" => Some(Self::Expense),
            "transfer" => Some(Self::Transfer),
            "investment" => Some(Self::Investment),
            _ => None,
        }
    }
}

/// The operation or transaction whose category is being validated.
///
/// `RuleAny` represents the configured scope of a categorization rule, not an effective
/// transaction context. Use [`is_rule_category_compatible`] with the context observed at runtime
/// when validating such a rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CategoryContext {
    Income,
    Expense,
    Transfer,
    CreditCardCharge,
    CreditCardRefund,
    RuleAny,
}

/// Validates a category against a concrete operation or transaction context.
///
/// Credit-card refunds keep the category of the original expense or investment. Protected
/// payments cannot be recategorized because their category is part of the settlement invariant.
/// `RuleAny` is rejected here because it needs an effective runtime context.
pub fn is_category_compatible(kind: CategoryKind, context: CategoryContext) -> bool {
    match context {
        CategoryContext::Income => kind == CategoryKind::Income,
        CategoryContext::Expense | CategoryContext::CreditCardCharge => {
            matches!(kind, CategoryKind::Expense | CategoryKind::Investment)
        }
        CategoryContext::Transfer => kind == CategoryKind::Transfer,
        CategoryContext::CreditCardRefund => {
            matches!(kind, CategoryKind::Expense | CategoryKind::Investment)
        }
        CategoryContext::RuleAny => false,
    }
}

/// Validates the category selected by a rule.
///
/// A rule configured for `RuleAny` inherits the effective context of each transaction instead of
/// bypassing compatibility. Specific rule contexts continue to enforce their configured scope.
pub fn is_rule_category_compatible(
    kind: CategoryKind,
    configured_context: CategoryContext,
    effective_context: CategoryContext,
) -> bool {
    let context = match configured_context {
        CategoryContext::RuleAny => effective_context,
        configured => configured,
    };
    is_category_compatible(kind, context)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_KINDS: [CategoryKind; 4] = [
        CategoryKind::Income,
        CategoryKind::Expense,
        CategoryKind::Transfer,
        CategoryKind::Investment,
    ];

    fn compatible_kinds(context: CategoryContext) -> Vec<CategoryKind> {
        ALL_KINDS
            .into_iter()
            .filter(|kind| is_category_compatible(*kind, context))
            .collect()
    }

    #[test]
    fn parses_and_serializes_persisted_category_kinds() {
        assert_eq!(CategoryKind::from_str("income"), Some(CategoryKind::Income));
        assert_eq!(
            CategoryKind::from_str("expense"),
            Some(CategoryKind::Expense)
        );
        assert_eq!(
            CategoryKind::from_str("transfer"),
            Some(CategoryKind::Transfer)
        );
        assert_eq!(
            CategoryKind::from_str("investment"),
            Some(CategoryKind::Investment)
        );
        assert_eq!(CategoryKind::from_str("unknown"), None);
        assert_eq!(CategoryKind::from_str("Income"), None);
    }

    #[test]
    fn income_only_accepts_income_categories() {
        assert_eq!(
            compatible_kinds(CategoryContext::Income),
            vec![CategoryKind::Income]
        );
    }

    #[test]
    fn expense_and_credit_card_charges_accept_expense_or_investment() {
        let expected = vec![CategoryKind::Expense, CategoryKind::Investment];
        assert_eq!(compatible_kinds(CategoryContext::Expense), expected);
        assert_eq!(
            compatible_kinds(CategoryContext::CreditCardCharge),
            expected
        );
    }

    #[test]
    fn transfer_only_accepts_transfer_categories() {
        assert_eq!(
            compatible_kinds(CategoryContext::Transfer),
            vec![CategoryKind::Transfer]
        );
    }

    #[test]
    fn credit_card_refunds_keep_expense_or_investment_semantics() {
        assert_eq!(
            compatible_kinds(CategoryContext::CreditCardRefund),
            vec![CategoryKind::Expense, CategoryKind::Investment]
        );
    }

    #[test]
    fn rule_any_is_not_a_compatibility_escape_hatch() {
        assert!(compatible_kinds(CategoryContext::RuleAny).is_empty());
        assert!(is_rule_category_compatible(
            CategoryKind::Income,
            CategoryContext::RuleAny,
            CategoryContext::Income,
        ));
        assert!(!is_rule_category_compatible(
            CategoryKind::Income,
            CategoryContext::RuleAny,
            CategoryContext::Expense,
        ));
        assert!(is_rule_category_compatible(
            CategoryKind::Investment,
            CategoryContext::RuleAny,
            CategoryContext::CreditCardRefund,
        ));
    }

    #[test]
    fn specific_rule_context_does_not_inherit_an_unrelated_runtime_context() {
        assert!(is_rule_category_compatible(
            CategoryKind::Expense,
            CategoryContext::Expense,
            CategoryContext::Income,
        ));
        assert!(!is_rule_category_compatible(
            CategoryKind::Income,
            CategoryContext::Expense,
            CategoryContext::Income,
        ));
    }
}
