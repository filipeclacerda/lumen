use crate::error::AppError;

pub fn parse_brl(value: &str) -> Result<i64, AppError> {
    let clean = value.trim().replace("R$", "").replace(' ', "");
    if clean.is_empty() { return Err(AppError::Validation("Valor vazio".into())); }
    let normalized = if clean.contains(',') {
        clean.replace('.', "").replace(',', ".")
    } else { clean };
    let number: f64 = normalized.parse().map_err(|_| AppError::Validation("Valor inválido".into()))?;
    Ok((number * 100.0).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn parses_brazilian_money() {
        assert_eq!(parse_brl("R$ 1.234,56").unwrap(), 123456);
        assert_eq!(parse_brl("-42,10").unwrap(), -4210);
    }
}
