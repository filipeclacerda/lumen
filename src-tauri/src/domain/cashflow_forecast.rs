use std::{
    collections::{BTreeMap, HashMap},
    error::Error,
    fmt,
};

/// The certainty assigned by the caller to a projected movement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForecastConfidence {
    Confirmed,
    Estimated,
}

/// Where a movement came from. This metadata is deliberately independent from
/// its layer: for example, a card invoice may already be pending or may still
/// be scheduled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForecastOrigin {
    Transaction,
    Import,
    Recurrence,
    Transfer,
}

/// Layers are applied cumulatively: realized, then pending, then scheduled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ForecastLayer {
    Realized,
    Pending,
    Scheduled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForecastMovement {
    pub date: String,
    pub amount_in_cents: i64,
    pub layer: ForecastLayer,
    pub confidence: ForecastConfidence,
    pub origin: ForecastOrigin,
    /// Opposite legs with the same identifier, date and layer are reduced to
    /// their net amount. Leave absent when projecting a single-account scope,
    /// where a transfer leg genuinely changes that account's balance.
    pub transfer_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ForecastLayerTotals {
    pub inflows_in_cents: i64,
    pub outflows_in_cents: i64,
    pub net_in_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CashflowForecast {
    pub initial_balance_in_cents: i64,
    pub realized_balance_in_cents: i64,
    pub balance_after_pending_in_cents: i64,
    pub projected_balance_in_cents: i64,
    pub minimum_balance_in_cents: i64,
    /// `None` means the initial balance, before the first movement, was the
    /// minimum. When several dates share a new minimum, the earliest is kept.
    pub minimum_balance_date: Option<String>,
    pub realized_totals: ForecastLayerTotals,
    pub pending_totals: ForecastLayerTotals,
    pub scheduled_totals: ForecastLayerTotals,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CashflowForecastError {
    InvalidDate,
    ArithmeticOverflow,
}

impl fmt::Display for CashflowForecastError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDate => formatter.write_str("a projeção contém uma data inválida"),
            Self::ArithmeticOverflow => {
                formatter.write_str("a projeção financeira excedeu o limite numérico")
            }
        }
    }
}

impl Error for CashflowForecastError {}

#[derive(Debug, Clone, Copy, Default)]
struct WideTotals {
    inflows: i128,
    outflows: i128,
    net: i128,
}

impl WideTotals {
    fn add(&mut self, amount: i128) -> Result<(), CashflowForecastError> {
        self.net = checked_add(self.net, amount)?;
        if amount >= 0 {
            self.inflows = checked_add(self.inflows, amount)?;
        } else {
            self.outflows = checked_add(self.outflows, checked_abs(amount)?)?;
        }
        Ok(())
    }

    fn narrow(self) -> Result<ForecastLayerTotals, CashflowForecastError> {
        Ok(ForecastLayerTotals {
            inflows_in_cents: narrow(self.inflows)?,
            outflows_in_cents: narrow(self.outflows)?,
            net_in_cents: narrow(self.net)?,
        })
    }
}

/// Builds a deterministic cash-flow forecast using integer cents only.
///
/// The initial balance is the balance immediately before the supplied
/// movements. Movements on the same date are settled together, so their input
/// order cannot create a fictitious intraday overdraft.
pub fn calculate_cashflow_forecast(
    initial_balance_in_cents: i64,
    movements: &[ForecastMovement],
) -> Result<CashflowForecast, CashflowForecastError> {
    for movement in movements {
        validate_iso_date(&movement.date)?;
    }

    let settled = settle_transfers(movements)?;
    let mut by_date = BTreeMap::<&str, i128>::new();
    let mut by_layer = BTreeMap::<ForecastLayer, WideTotals>::new();

    for movement in &settled {
        let amount = movement.amount;
        let date_total = by_date.entry(movement.date).or_default();
        *date_total = checked_add(*date_total, amount)?;
        by_layer.entry(movement.layer).or_default().add(amount)?;
    }

    let realized = by_layer
        .get(&ForecastLayer::Realized)
        .copied()
        .unwrap_or_default();
    let pending = by_layer
        .get(&ForecastLayer::Pending)
        .copied()
        .unwrap_or_default();
    let scheduled = by_layer
        .get(&ForecastLayer::Scheduled)
        .copied()
        .unwrap_or_default();

    let initial = i128::from(initial_balance_in_cents);
    let realized_balance = checked_add(initial, realized.net)?;
    let balance_after_pending = checked_add(realized_balance, pending.net)?;
    let projected_balance = checked_add(balance_after_pending, scheduled.net)?;

    let mut running_balance = initial;
    let mut minimum_balance = initial;
    let mut minimum_date = None;
    for (date, amount) in by_date {
        running_balance = checked_add(running_balance, amount)?;
        if running_balance < minimum_balance {
            minimum_balance = running_balance;
            minimum_date = Some(date.to_owned());
        }
    }

    // The chronological path and the layer totals must describe the same final
    // balance. Keeping this checked also protects future refactors.
    if running_balance != projected_balance {
        return Err(CashflowForecastError::ArithmeticOverflow);
    }

    Ok(CashflowForecast {
        initial_balance_in_cents,
        realized_balance_in_cents: narrow(realized_balance)?,
        balance_after_pending_in_cents: narrow(balance_after_pending)?,
        projected_balance_in_cents: narrow(projected_balance)?,
        minimum_balance_in_cents: narrow(minimum_balance)?,
        minimum_balance_date: minimum_date,
        realized_totals: realized.narrow()?,
        pending_totals: pending.narrow()?,
        scheduled_totals: scheduled.narrow()?,
    })
}

#[derive(Debug, Clone, Copy)]
struct SettledMovement<'a> {
    date: &'a str,
    amount: i128,
    layer: ForecastLayer,
}

fn settle_transfers(
    movements: &[ForecastMovement],
) -> Result<Vec<SettledMovement<'_>>, CashflowForecastError> {
    let mut settled = Vec::with_capacity(movements.len());
    let mut transfer_groups = HashMap::<(&str, &str, ForecastLayer), i128>::new();

    for movement in movements {
        if movement.origin == ForecastOrigin::Transfer {
            if let Some(transfer_id) = movement.transfer_id.as_deref() {
                let total = transfer_groups
                    .entry((&movement.date, transfer_id, movement.layer))
                    .or_default();
                *total = checked_add(*total, i128::from(movement.amount_in_cents))?;
                continue;
            }
        }

        settled.push(SettledMovement {
            date: &movement.date,
            amount: i128::from(movement.amount_in_cents),
            layer: movement.layer,
        });
    }

    for ((date, _transfer_id, layer), amount) in transfer_groups {
        if amount != 0 {
            settled.push(SettledMovement {
                date,
                amount,
                layer,
            });
        }
    }

    Ok(settled)
}

fn validate_iso_date(date: &str) -> Result<(), CashflowForecastError> {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(CashflowForecastError::InvalidDate);
    }
    if bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return Err(CashflowForecastError::InvalidDate);
    }

    let year = parse_date_component(&bytes[0..4])?;
    let month = parse_date_component(&bytes[5..7])?;
    let day = parse_date_component(&bytes[8..10])?;
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return Err(CashflowForecastError::InvalidDate),
    };
    if year == 0 || day == 0 || day > days_in_month {
        return Err(CashflowForecastError::InvalidDate);
    }
    Ok(())
}

fn parse_date_component(bytes: &[u8]) -> Result<u32, CashflowForecastError> {
    bytes.iter().try_fold(0u32, |value, byte| {
        value
            .checked_mul(10)
            .and_then(|value| value.checked_add(u32::from(byte - b'0')))
            .ok_or(CashflowForecastError::InvalidDate)
    })
}

fn is_leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

fn checked_add(left: i128, right: i128) -> Result<i128, CashflowForecastError> {
    left.checked_add(right)
        .ok_or(CashflowForecastError::ArithmeticOverflow)
}

fn checked_abs(value: i128) -> Result<i128, CashflowForecastError> {
    value
        .checked_abs()
        .ok_or(CashflowForecastError::ArithmeticOverflow)
}

fn narrow(value: i128) -> Result<i64, CashflowForecastError> {
    i64::try_from(value).map_err(|_| CashflowForecastError::ArithmeticOverflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn movement(date: &str, amount: i64, layer: ForecastLayer) -> ForecastMovement {
        ForecastMovement {
            date: date.to_owned(),
            amount_in_cents: amount,
            layer,
            confidence: ForecastConfidence::Confirmed,
            origin: ForecastOrigin::Transaction,
            transfer_id: None,
        }
    }

    #[test]
    fn calculates_layer_balances_and_signed_totals() {
        let movements = [
            movement("2026-07-01", 100_000, ForecastLayer::Realized),
            movement("2026-07-02", -35_000, ForecastLayer::Realized),
            movement("2026-07-10", -20_000, ForecastLayer::Pending),
            movement("2026-08-05", 50_000, ForecastLayer::Scheduled),
            movement("2026-08-06", -15_000, ForecastLayer::Scheduled),
        ];

        let forecast = calculate_cashflow_forecast(10_000, &movements).unwrap();

        assert_eq!(forecast.realized_balance_in_cents, 75_000);
        assert_eq!(forecast.balance_after_pending_in_cents, 55_000);
        assert_eq!(forecast.projected_balance_in_cents, 90_000);
        assert_eq!(
            forecast.realized_totals,
            ForecastLayerTotals {
                inflows_in_cents: 100_000,
                outflows_in_cents: 35_000,
                net_in_cents: 65_000,
            }
        );
        assert_eq!(forecast.pending_totals.net_in_cents, -20_000);
        assert_eq!(forecast.scheduled_totals.net_in_cents, 35_000);
    }

    #[test]
    fn respects_month_boundaries_and_finds_the_earliest_minimum() {
        let movements = [
            movement("2026-02-28", -7_000, ForecastLayer::Pending),
            movement("2026-03-01", -5_000, ForecastLayer::Scheduled),
            movement("2026-03-02", 5_000, ForecastLayer::Scheduled),
            movement("2026-03-03", -5_000, ForecastLayer::Scheduled),
        ];

        let forecast = calculate_cashflow_forecast(10_000, &movements).unwrap();

        assert_eq!(forecast.minimum_balance_in_cents, -2_000);
        assert_eq!(forecast.minimum_balance_date.as_deref(), Some("2026-03-01"));
        assert_eq!(forecast.projected_balance_in_cents, -2_000);
    }

    #[test]
    fn same_day_order_cannot_create_a_fictitious_minimum() {
        let debit_first = [
            movement("2026-07-10", -100_000, ForecastLayer::Pending),
            movement("2026-07-10", 100_000, ForecastLayer::Pending),
        ];
        let credit_first = [debit_first[1].clone(), debit_first[0].clone()];

        let first = calculate_cashflow_forecast(50_000, &debit_first).unwrap();
        let second = calculate_cashflow_forecast(50_000, &credit_first).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.minimum_balance_in_cents, 50_000);
        assert_eq!(first.minimum_balance_date, None);
    }

    #[test]
    fn opposite_transfer_legs_are_net_and_do_not_inflate_totals() {
        let mut debit = movement("2026-07-10", -80_000, ForecastLayer::Realized);
        debit.origin = ForecastOrigin::Transfer;
        debit.transfer_id = Some("transfer-1".to_owned());
        let mut credit = debit.clone();
        credit.amount_in_cents = 80_000;

        let forecast = calculate_cashflow_forecast(200_000, &[debit, credit]).unwrap();

        assert_eq!(forecast.projected_balance_in_cents, 200_000);
        assert_eq!(forecast.minimum_balance_in_cents, 200_000);
        assert_eq!(forecast.realized_totals, ForecastLayerTotals::default());
    }

    #[test]
    fn unpaired_transfer_leg_changes_a_scoped_forecast() {
        let mut transfer = movement("2026-07-10", -80_000, ForecastLayer::Pending);
        transfer.origin = ForecastOrigin::Transfer;

        let forecast = calculate_cashflow_forecast(200_000, &[transfer]).unwrap();

        assert_eq!(forecast.balance_after_pending_in_cents, 120_000);
        assert_eq!(forecast.pending_totals.outflows_in_cents, 80_000);
    }

    #[test]
    fn rejects_invalid_dates_including_non_leap_boundaries() {
        for date in ["2026-2-01", "2026-02-29", "2026-04-31", "0000-01-01"] {
            let result =
                calculate_cashflow_forecast(0, &[movement(date, 1, ForecastLayer::Scheduled)]);
            assert_eq!(result, Err(CashflowForecastError::InvalidDate), "{date}");
        }

        assert!(calculate_cashflow_forecast(
            0,
            &[movement("2028-02-29", 1, ForecastLayer::Scheduled)]
        )
        .is_ok());
    }

    #[test]
    fn returns_safe_overflow_error_when_public_cents_cannot_be_represented() {
        let movements = [
            movement("2026-07-01", i64::MAX, ForecastLayer::Realized),
            movement("2026-07-02", 1, ForecastLayer::Realized),
        ];

        assert_eq!(
            calculate_cashflow_forecast(0, &movements),
            Err(CashflowForecastError::ArithmeticOverflow)
        );
    }

    #[test]
    fn preserves_balance_and_layer_invariants_for_mixed_signs() {
        let movements = [
            movement("2026-07-01", -i64::MAX, ForecastLayer::Realized),
            movement("2026-07-01", i64::MAX, ForecastLayer::Realized),
            movement("2026-07-02", 1, ForecastLayer::Pending),
            movement("2026-07-03", -1, ForecastLayer::Scheduled),
        ];

        let forecast = calculate_cashflow_forecast(1, &movements).unwrap();

        assert_eq!(
            forecast.realized_totals.net_in_cents,
            forecast.realized_totals.inflows_in_cents - forecast.realized_totals.outflows_in_cents
        );
        assert_eq!(
            forecast.realized_balance_in_cents,
            forecast.initial_balance_in_cents + forecast.realized_totals.net_in_cents
        );
        assert_eq!(
            forecast.balance_after_pending_in_cents,
            forecast.realized_balance_in_cents + forecast.pending_totals.net_in_cents
        );
        assert_eq!(
            forecast.projected_balance_in_cents,
            forecast.balance_after_pending_in_cents + forecast.scheduled_totals.net_in_cents
        );
    }
}
