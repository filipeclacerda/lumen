use std::{error::Error, fmt, str::FromStr};

/// Account information that affects the financial meaning of an entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialAccountKind {
    Bank,
    CreditCard,
}

impl FinancialAccountKind {
    pub fn from_database_value(value: &str) -> Self {
        if value == "credit_card" {
            Self::CreditCard
        } else {
            Self::Bank
        }
    }
}

/// Category kinds that participate in financial summaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialCategoryKind {
    Income,
    Expense,
    Investment,
    Transfer,
}

impl FromStr for FinancialCategoryKind {
    type Err = ParseFinancialKindError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "income" => Ok(Self::Income),
            "expense" => Ok(Self::Expense),
            "investment" => Ok(Self::Investment),
            "transfer" => Ok(Self::Transfer),
            _ => Err(ParseFinancialKindError),
        }
    }
}

/// A link is stronger evidence than a category and therefore takes precedence
/// during classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialLinkedKind {
    Transfer,
    CreditCardPayment,
}

impl FromStr for FinancialLinkedKind {
    type Err = ParseFinancialKindError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "transfer" => Ok(Self::Transfer),
            "credit_card_payment" => Ok(Self::CreditCardPayment),
            _ => Err(ParseFinancialKindError),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParseFinancialKindError;

impl fmt::Display for ParseFinancialKindError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("tipo financeiro inválido")
    }
}

impl Error for ParseFinancialKindError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FinancialEntry {
    pub amount_in_cents: i64,
    pub account_kind: FinancialAccountKind,
    pub category_kind: Option<FinancialCategoryKind>,
    pub linked_kind: Option<FinancialLinkedKind>,
}

/// The mutually exclusive financial meaning of one persisted transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialClassification {
    Income,
    IncomeReversal,
    Expense,
    ExpenseRefund,
    InvestmentContribution,
    InvestmentRedemption,
    Transfer,
    CreditCardPayment,
    UncategorizedCreditCardExpense,
    UncategorizedCreditCardRefund,
    Ignored,
}

/// Classifies one transaction without performing I/O or relying on its
/// description. Positive expense/investment entries reverse their usual
/// direction, while linked transfers and card payments never affect metrics.
pub fn classify_financial_entry(entry: &FinancialEntry) -> FinancialClassification {
    if let Some(linked_kind) = entry.linked_kind {
        return match linked_kind {
            FinancialLinkedKind::Transfer => FinancialClassification::Transfer,
            FinancialLinkedKind::CreditCardPayment => FinancialClassification::CreditCardPayment,
        };
    }

    if entry.category_kind == Some(FinancialCategoryKind::Transfer) {
        return FinancialClassification::Transfer;
    }

    match (
        entry.account_kind,
        entry.category_kind,
        entry.amount_in_cents,
    ) {
        (_, _, 0) => FinancialClassification::Ignored,
        (FinancialAccountKind::CreditCard, None, amount) if amount < 0 => {
            FinancialClassification::UncategorizedCreditCardExpense
        }
        (FinancialAccountKind::CreditCard, None, _) => {
            FinancialClassification::UncategorizedCreditCardRefund
        }
        // A credit-card entry categorized as income is inconsistent and must
        // not leak into income or expense totals.
        (FinancialAccountKind::CreditCard, Some(FinancialCategoryKind::Income), _) => {
            FinancialClassification::Ignored
        }
        (_, Some(FinancialCategoryKind::Income), amount) if amount > 0 => {
            FinancialClassification::Income
        }
        (_, Some(FinancialCategoryKind::Income), _) => FinancialClassification::IncomeReversal,
        (_, Some(FinancialCategoryKind::Expense), amount) if amount < 0 => {
            FinancialClassification::Expense
        }
        (_, Some(FinancialCategoryKind::Expense), _) => FinancialClassification::ExpenseRefund,
        (_, Some(FinancialCategoryKind::Investment), amount) if amount < 0 => {
            FinancialClassification::InvestmentContribution
        }
        (_, Some(FinancialCategoryKind::Investment), _) => {
            FinancialClassification::InvestmentRedemption
        }
        (_, None, amount) if amount > 0 => FinancialClassification::Income,
        (_, None, _) => FinancialClassification::Expense,
        (_, Some(FinancialCategoryKind::Transfer), _) => FinancialClassification::Transfer,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialMetricsError {
    ArithmeticOverflow,
}

impl fmt::Display for FinancialMetricsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("as métricas financeiras excederam o limite numérico")
    }
}

impl Error for FinancialMetricsError {}

/// Aggregated values use `i128` so a valid set of `i64` transactions is not
/// narrowed while it is being summarized.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct FinancialMetrics {
    pub gross_income_in_cents: i128,
    pub income_reversals_in_cents: i128,
    pub income_in_cents: i128,
    pub gross_expenses_in_cents: i128,
    pub expense_refunds_in_cents: i128,
    pub expenses_in_cents: i128,
    pub investment_contributions_in_cents: i128,
    pub investment_redemptions_in_cents: i128,
    pub investments_in_cents: i128,
    pub savings_in_cents: i128,
    pub net_cash_flow_in_cents: i128,
}

impl FinancialMetrics {
    pub fn try_from_entries<'a>(
        entries: impl IntoIterator<Item = &'a FinancialEntry>,
    ) -> Result<Self, FinancialMetricsError> {
        let mut metrics = Self::default();

        for entry in entries {
            let amount = i128::from(entry.amount_in_cents);
            let magnitude = amount
                .checked_abs()
                .ok_or(FinancialMetricsError::ArithmeticOverflow)?;

            match classify_financial_entry(entry) {
                FinancialClassification::Income => {
                    checked_add(&mut metrics.gross_income_in_cents, magnitude)?;
                }
                FinancialClassification::IncomeReversal => {
                    checked_add(&mut metrics.income_reversals_in_cents, magnitude)?;
                }
                FinancialClassification::Expense
                | FinancialClassification::UncategorizedCreditCardExpense => {
                    checked_add(&mut metrics.gross_expenses_in_cents, magnitude)?;
                }
                FinancialClassification::ExpenseRefund
                | FinancialClassification::UncategorizedCreditCardRefund => {
                    checked_add(&mut metrics.expense_refunds_in_cents, magnitude)?;
                }
                FinancialClassification::InvestmentContribution => {
                    checked_add(&mut metrics.investment_contributions_in_cents, magnitude)?;
                }
                FinancialClassification::InvestmentRedemption => {
                    checked_add(&mut metrics.investment_redemptions_in_cents, magnitude)?;
                }
                FinancialClassification::Transfer
                | FinancialClassification::CreditCardPayment
                | FinancialClassification::Ignored => {}
            }
        }

        metrics.income_in_cents = checked_sub(
            metrics.gross_income_in_cents,
            metrics.income_reversals_in_cents,
        )?;
        metrics.expenses_in_cents = checked_sub(
            metrics.gross_expenses_in_cents,
            metrics.expense_refunds_in_cents,
        )?;
        metrics.investments_in_cents = checked_sub(
            metrics.investment_contributions_in_cents,
            metrics.investment_redemptions_in_cents,
        )?;
        metrics.savings_in_cents = checked_sub(metrics.income_in_cents, metrics.expenses_in_cents)?;
        metrics.net_cash_flow_in_cents =
            checked_sub(metrics.savings_in_cents, metrics.investments_in_cents)?;

        Ok(metrics)
    }
}

fn checked_add(target: &mut i128, value: i128) -> Result<(), FinancialMetricsError> {
    *target = target
        .checked_add(value)
        .ok_or(FinancialMetricsError::ArithmeticOverflow)?;
    Ok(())
}

fn checked_sub(left: i128, right: i128) -> Result<i128, FinancialMetricsError> {
    left.checked_sub(right)
        .ok_or(FinancialMetricsError::ArithmeticOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        amount_in_cents: i64,
        account_kind: FinancialAccountKind,
        category_kind: Option<FinancialCategoryKind>,
        linked_kind: Option<FinancialLinkedKind>,
    ) -> FinancialEntry {
        FinancialEntry {
            amount_in_cents,
            account_kind,
            category_kind,
            linked_kind,
        }
    }

    #[test]
    fn parses_database_kinds_without_opaque_string_classification() {
        assert_eq!(
            FinancialAccountKind::from_database_value("credit_card"),
            FinancialAccountKind::CreditCard
        );
        assert_eq!(
            FinancialAccountKind::from_database_value("checking"),
            FinancialAccountKind::Bank
        );
        assert_eq!("investment".parse(), Ok(FinancialCategoryKind::Investment));
        assert_eq!(
            "credit_card_payment".parse(),
            Ok(FinancialLinkedKind::CreditCardPayment)
        );
        assert!("unknown".parse::<FinancialCategoryKind>().is_err());
    }

    #[test]
    fn classifies_each_supported_financial_direction() {
        let bank = FinancialAccountKind::Bank;
        let card = FinancialAccountKind::CreditCard;
        let cases = [
            (
                entry(500_000, bank, Some(FinancialCategoryKind::Income), None),
                FinancialClassification::Income,
            ),
            (
                entry(-20_000, bank, Some(FinancialCategoryKind::Income), None),
                FinancialClassification::IncomeReversal,
            ),
            (
                entry(-120_000, bank, Some(FinancialCategoryKind::Expense), None),
                FinancialClassification::Expense,
            ),
            (
                entry(15_000, bank, Some(FinancialCategoryKind::Expense), None),
                FinancialClassification::ExpenseRefund,
            ),
            (
                entry(-80_000, bank, Some(FinancialCategoryKind::Investment), None),
                FinancialClassification::InvestmentContribution,
            ),
            (
                entry(30_000, bank, Some(FinancialCategoryKind::Investment), None),
                FinancialClassification::InvestmentRedemption,
            ),
            (
                entry(-10_000, card, None, None),
                FinancialClassification::UncategorizedCreditCardExpense,
            ),
            (
                entry(2_000, card, None, None),
                FinancialClassification::UncategorizedCreditCardRefund,
            ),
        ];

        for (entry, expected) in cases {
            assert_eq!(classify_financial_entry(&entry), expected);
        }
    }

    #[test]
    fn links_override_categories_and_are_excluded_from_metrics() {
        let entries = [
            entry(
                -150_000,
                FinancialAccountKind::Bank,
                Some(FinancialCategoryKind::Expense),
                Some(FinancialLinkedKind::Transfer),
            ),
            entry(
                -90_000,
                FinancialAccountKind::Bank,
                Some(FinancialCategoryKind::Expense),
                Some(FinancialLinkedKind::CreditCardPayment),
            ),
            entry(
                150_000,
                FinancialAccountKind::Bank,
                Some(FinancialCategoryKind::Transfer),
                None,
            ),
        ];

        assert_eq!(
            classify_financial_entry(&entries[0]),
            FinancialClassification::Transfer
        );
        assert_eq!(
            classify_financial_entry(&entries[1]),
            FinancialClassification::CreditCardPayment
        );
        assert_eq!(
            FinancialMetrics::try_from_entries(&entries).unwrap(),
            FinancialMetrics::default()
        );
    }

    #[test]
    fn aggregates_gross_reversals_and_net_values_with_checked_i128_arithmetic() {
        let bank = FinancialAccountKind::Bank;
        let card = FinancialAccountKind::CreditCard;
        let entries = [
            entry(500_000, bank, Some(FinancialCategoryKind::Income), None),
            entry(-25_000, bank, Some(FinancialCategoryKind::Income), None),
            entry(-140_000, bank, Some(FinancialCategoryKind::Expense), None),
            entry(20_000, bank, Some(FinancialCategoryKind::Expense), None),
            entry(-15_000, card, None, None),
            entry(5_000, card, None, None),
            entry(
                -100_000,
                bank,
                Some(FinancialCategoryKind::Investment),
                None,
            ),
            entry(30_000, bank, Some(FinancialCategoryKind::Investment), None),
        ];

        let metrics = FinancialMetrics::try_from_entries(&entries).unwrap();

        assert_eq!(metrics.gross_income_in_cents, 500_000);
        assert_eq!(metrics.income_reversals_in_cents, 25_000);
        assert_eq!(metrics.income_in_cents, 475_000);
        assert_eq!(metrics.gross_expenses_in_cents, 155_000);
        assert_eq!(metrics.expense_refunds_in_cents, 25_000);
        assert_eq!(metrics.expenses_in_cents, 130_000);
        assert_eq!(metrics.investment_contributions_in_cents, 100_000);
        assert_eq!(metrics.investment_redemptions_in_cents, 30_000);
        assert_eq!(metrics.investments_in_cents, 70_000);
        assert_eq!(metrics.savings_in_cents, 345_000);
        assert_eq!(metrics.net_cash_flow_in_cents, 275_000);
    }

    #[test]
    fn handles_i64_min_without_abs_overflow() {
        let entries = [entry(
            i64::MIN,
            FinancialAccountKind::Bank,
            Some(FinancialCategoryKind::Expense),
            None,
        )];

        let metrics = FinancialMetrics::try_from_entries(&entries).unwrap();

        assert_eq!(metrics.gross_expenses_in_cents, 1i128 << 63);
        assert_eq!(metrics.expenses_in_cents, 1i128 << 63);
    }

    #[test]
    fn ignores_zero_and_inconsistent_credit_card_income() {
        let entries = [
            entry(
                0,
                FinancialAccountKind::Bank,
                Some(FinancialCategoryKind::Expense),
                None,
            ),
            entry(
                10_000,
                FinancialAccountKind::CreditCard,
                Some(FinancialCategoryKind::Income),
                None,
            ),
        ];

        assert_eq!(
            classify_financial_entry(&entries[0]),
            FinancialClassification::Ignored
        );
        assert_eq!(
            classify_financial_entry(&entries[1]),
            FinancialClassification::Ignored
        );
        assert_eq!(
            FinancialMetrics::try_from_entries(&entries).unwrap(),
            FinancialMetrics::default()
        );
    }
}
