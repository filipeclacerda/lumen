use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecimalSeparator {
    Comma,
    Dot,
    Auto,
}

pub fn parse_brl(value: &str) -> Result<i64, AppError> {
    parse_money(value, DecimalSeparator::Auto)
}

pub fn parse_money(value: &str, separator: DecimalSeparator) -> Result<i64, AppError> {
    let mut input = value.trim().replace(' ', "");
    if input.is_empty() {
        return invalid();
    }
    if input.eq_ignore_ascii_case("nan")
        || input.eq_ignore_ascii_case("inf")
        || input.eq_ignore_ascii_case("infinity")
        || input.contains('e')
        || input.contains('E')
    {
        return invalid();
    }
    if input.starts_with("R$") || input.starts_with("r$") {
        input.drain(..2);
    } else if input.contains("R$") || input.contains("r$") {
        return invalid();
    }
    if input.is_empty() {
        return invalid();
    }
    let negative = input.starts_with('-')
        || (input.starts_with('(') && input.ends_with(')'))
        || input.ends_with('-');
    let positive = input.starts_with('+');
    let sign_count = input.chars().filter(|c| *c == '+' || *c == '-').count();
    if negative && positive
        || sign_count > 1
        || (sign_count == 1 && !input.starts_with(['+', '-']) && !input.ends_with(['+', '-']))
    {
        return invalid();
    }
    if input.starts_with('(') || input.ends_with(')') {
        if !(input.starts_with('(') && input.ends_with(')')) {
            return invalid();
        }
        input = input[1..input.len() - 1].to_string();
    }
    input = input.trim_matches(['+', '-']).to_string();
    if input.is_empty() || input.contains(['+', '-']) {
        return invalid();
    }
    let decimal = match separator {
        DecimalSeparator::Comma => ',',
        DecimalSeparator::Dot => '.',
        DecimalSeparator::Auto => {
            if input.contains(',') {
                ','
            } else {
                '.'
            }
        }
    };
    let grouping = if decimal == ',' { '.' } else { ',' };
    let (whole, fraction) = match input.split_once(decimal) {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (input.as_str(), None),
    };
    if whole.is_empty() || whole.contains(decimal) || fraction.is_some_and(|f| f.contains(decimal))
    {
        return invalid();
    }
    if whole.contains(grouping) {
        let mut groups = whole.split(grouping);
        let first = groups.next().unwrap_or_default();
        if first.is_empty()
            || first.len() > 3
            || !first.chars().all(|c| c.is_ascii_digit())
            || groups.any(|part| part.len() != 3 || !part.chars().all(|c| c.is_ascii_digit()))
        {
            return invalid();
        }
    } else if !whole.chars().all(|c| c.is_ascii_digit()) {
        return invalid();
    }
    let whole_digits: String = whole.chars().filter(|c| *c != grouping).collect();
    let fraction = match fraction {
        Some(value) if !value.is_empty() => value,
        Some(_) => return invalid(),
        None => "",
    };
    if fraction.len() > 2 || !fraction.chars().all(|c| c.is_ascii_digit()) {
        return invalid();
    }
    let whole_value = parse_digits(&whole_digits)?;
    let fraction_value = match fraction.len() {
        0 => 0,
        1 => parse_digits(fraction)?
            .checked_mul(10)
            .ok_or_else(invalid_error)?,
        2 => parse_digits(fraction)?,
        _ => return invalid(),
    };
    let magnitude = whole_value
        .checked_mul(100)
        .and_then(|v| v.checked_add(fraction_value))
        .ok_or_else(invalid_error)?;
    if negative {
        if magnitude > i64::MAX as u64 {
            return invalid();
        }
        Ok(-(magnitude as i64))
    } else {
        i64::try_from(magnitude).map_err(|_| invalid_error())
    }
}

fn parse_digits(value: &str) -> Result<u64, AppError> {
    if value.is_empty() {
        return invalid();
    }
    value.chars().try_fold(0u64, |acc, c| {
        let digit = c.to_digit(10).ok_or_else(invalid_error)? as u64;
        acc.checked_mul(10)
            .and_then(|v| v.checked_add(digit))
            .ok_or_else(invalid_error)
    })
}

fn invalid_error() -> AppError {
    AppError::Validation("Valor inválido".into())
}
fn invalid<T>() -> Result<T, AppError> {
    Err(invalid_error())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_brazilian_money() {
        assert_eq!(parse_brl("R$ 1.234,56").unwrap(), 123456);
        assert_eq!(parse_brl("-42,10").unwrap(), -4210);
    }
    #[test]
    fn parses_integer_without_float_and_rejects_special_values() {
        assert_eq!(parse_money("+10.5", DecimalSeparator::Dot).unwrap(), 1050);
        assert_eq!(
            parse_money("1,234.56", DecimalSeparator::Dot).unwrap(),
            123456
        );
        for value in [
            "NaN",
            "Infinity",
            "1e3",
            "1,",
            "--1",
            "1.000,000",
            "1R$2,00",
        ] {
            assert!(parse_brl(value).is_err(), "{value}");
        }
    }
    #[test]
    fn handles_i64_limits_in_cents() {
        assert_eq!(
            parse_money("92233720368547758,07", DecimalSeparator::Comma).unwrap(),
            i64::MAX
        );
        assert!(parse_money("-92233720368547758,08", DecimalSeparator::Comma).is_err());
        assert!(parse_money("92233720368547758,08", DecimalSeparator::Comma).is_err());
    }
}
