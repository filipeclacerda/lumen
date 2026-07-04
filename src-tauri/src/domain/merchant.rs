use regex::Regex;
use std::sync::OnceLock;

/// Prefixos de meio de pagamento/adquirente que não identificam o estabelecimento em si.
/// Lista fácil de estender conforme surgirem novos extratos reais.
const PAYMENT_PREFIXES: &[&str] = &[
    "PAG*", "PG *", "PAGSEGURO*", "MP *", "MERCADOPAGO*", "PIX QRS",
    "COMPRA COM CARTAO", "COMPRA CARTAO", "DEB AUT", "TED", "DOC",
];

/// Sufixos societários que não ajudam a distinguir estabelecimentos ("LTDA" x "ME").
const COMPANY_SUFFIXES: &[&str] = &["LTDA", "EIRELI", "EPP", "S A", "SA", "ME"];

struct Patterns {
    prefixes: Vec<Regex>,
    trailing_installment: Regex,
    long_number: Regex,
    date: Regex,
    time: Regex,
    suffixes: Vec<Regex>,
    whitespace: Regex,
}

fn patterns() -> &'static Patterns {
    static PATTERNS: OnceLock<Patterns> = OnceLock::new();
    PATTERNS.get_or_init(|| Patterns {
        prefixes: PAYMENT_PREFIXES.iter()
            .map(|prefix| Regex::new(&format!(r"^{}\s*", regex::escape(prefix))).unwrap())
            .collect(),
        trailing_installment: Regex::new(r"\s*\b\d{1,2}/\d{1,2}\b\s*$").unwrap(),
        long_number: Regex::new(r"\d{5,}").unwrap(),
        date: Regex::new(r"\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b").unwrap(),
        time: Regex::new(r"\b\d{1,2}:\d{2}(:\d{2})?\b").unwrap(),
        suffixes: COMPANY_SUFFIXES.iter()
            .map(|suffix| Regex::new(&format!(r"\b{}\b\.?\s*$", regex::escape(suffix))).unwrap())
            .collect(),
        whitespace: Regex::new(r"\s+").unwrap(),
    })
}

/// Deriva a chave de agrupamento de um estabelecimento a partir da descrição já normalizada
/// (uppercase + espaços colapsados, ver `domain::import::normalize_description`).
///
/// Pipeline determinístico: remove ruído comprovado (prefixos de meio de pagamento, parcelas,
/// datas/horários/números longos, sufixos societários) mas nunca remove palavras de conteúdo,
/// para não fundir estabelecimentos distintos. Se o resultado ficar vazio, cai de volta para a
/// descrição normalizada original — a chave nunca é vazia.
pub fn merchant_key(normalized_description: &str) -> String {
    let p = patterns();
    let mut value = normalized_description.trim().to_string();

    for prefix in &p.prefixes {
        value = prefix.replace(&value, "").into_owned();
    }
    value = p.trailing_installment.replace(&value, "").into_owned();
    value = p.date.replace_all(&value, "").into_owned();
    value = p.time.replace_all(&value, "").into_owned();
    value = p.long_number.replace_all(&value, "").into_owned();
    for suffix in &p.suffixes {
        value = suffix.replace(&value, "").into_owned();
    }
    value = p.whitespace.replace_all(value.trim(), " ").trim().to_string();

    if value.is_empty() {
        normalized_description.to_string()
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_payment_installment_and_company_suffix_variants() {
        assert_eq!(merchant_key("SUPERMERCADO BH LTDA"), "SUPERMERCADO BH");
        assert_eq!(merchant_key("COMPRA CARTAO SUPERMERCADO BH 02/06"), "SUPERMERCADO BH");
        assert_eq!(merchant_key("COMPRA CARTAO 1234 SUPERMERCADO BH 03/10"), "1234 SUPERMERCADO BH");
    }

    #[test]
    fn strips_pagseguro_and_mercadopago_prefixes() {
        assert_eq!(merchant_key("PAG*JOSESILVA"), "JOSESILVA");
        assert_eq!(merchant_key("PG *OFICINA DO JOAO"), "OFICINA DO JOAO");
        assert_eq!(merchant_key("MERCADOPAGO*LOJA XPTO"), "LOJA XPTO");
        assert_eq!(merchant_key("MP *FEIRA LIVRE"), "FEIRA LIVRE");
    }

    #[test]
    fn strips_pix_and_ted_doc_prefixes() {
        assert_eq!(merchant_key("PIX QRS JOAO DA SILVA"), "JOAO DA SILVA");
        assert_eq!(merchant_key("TED JOAO DA SILVA"), "JOAO DA SILVA");
        assert_eq!(merchant_key("DOC MARIA OLIVEIRA"), "MARIA OLIVEIRA");
    }

    #[test]
    fn strips_long_numbers_but_keeps_short_ones() {
        assert_eq!(merchant_key("SUPERMERCADO BH AUT123456"), "SUPERMERCADO BH AUT");
        assert_eq!(merchant_key("POSTO BR 24H"), "POSTO BR 24H");
    }

    #[test]
    fn strips_dates_and_times() {
        assert_eq!(merchant_key("SUPERMERCADO BH 02/06/2026"), "SUPERMERCADO BH");
        assert_eq!(merchant_key("SUPERMERCADO BH 14:32"), "SUPERMERCADO BH");
    }

    #[test]
    fn falls_back_to_original_when_result_would_be_empty() {
        assert_eq!(merchant_key("03/10"), "03/10");
        assert_eq!(merchant_key("LTDA"), "LTDA");
    }

    #[test]
    fn never_merges_distinct_content_words() {
        assert_ne!(merchant_key("POSTO BR CENTRO"), merchant_key("POSTO BR ZONA SUL"));
    }

    #[test]
    fn deb_aut_prefix_is_removed() {
        assert_eq!(merchant_key("DEB AUT NETFLIX COM"), "NETFLIX COM");
    }
}
