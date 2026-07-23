use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

use super::{
    category_vocabulary::PT_BR_CATEGORY_VOCABULARY,
    import::{CategorySuggestion, CategorySuggestionSource},
};

/// A merchant needs at least this many categorized occurrences of the winning category before
/// we trust it enough to suggest it automatically on a brand new import.
pub const MIN_OCCURRENCES: i64 = 2;
/// The winning category must hold at least this share of the merchant's categorized history.
pub const MIN_DOMINANCE_PERCENT: f64 = 70.0;

#[derive(Debug, Clone)]
pub struct MerchantCategoryStat {
    pub category_id: String,
    pub category_name: Option<String>,
    pub category_kind: String,
    pub count: i64,
    pub last_used: String,
}

#[derive(Debug, Clone)]
pub struct HistoricalCategoryStat {
    pub merchant_key: String,
    pub category_id: String,
    pub category_name: String,
    pub category_kind: String,
    pub count: i64,
    pub last_used: String,
}

#[derive(Debug, Clone)]
pub struct CategoryDefinition {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionContext {
    Bank,
    CreditCard,
}

struct IndexedHistoryRow {
    category_id: String,
    category_name: String,
    category_kind: String,
    count: i64,
    last_used: String,
    tokens: HashSet<String>,
}

pub struct SuggestionIndex {
    history: Vec<IndexedHistoryRow>,
    by_token: HashMap<String, Vec<usize>>,
}

impl SuggestionIndex {
    pub fn new(history: &[HistoricalCategoryStat]) -> Self {
        let mut grouped: HashMap<(Vec<String>, String), IndexedHistoryRow> = HashMap::new();
        for row in history {
            let tokens = meaningful_tokens(&row.merchant_key);
            let mut token_key: Vec<_> = tokens.iter().cloned().collect();
            token_key.sort();
            let indexed = grouped
                .entry((token_key, row.category_id.clone()))
                .or_insert_with(|| IndexedHistoryRow {
                    category_id: row.category_id.clone(),
                    category_name: row.category_name.clone(),
                    category_kind: row.category_kind.clone(),
                    count: 0,
                    last_used: row.last_used.clone(),
                    tokens,
                });
            indexed.count += row.count;
            if row.last_used > indexed.last_used {
                indexed.last_used = row.last_used.clone();
            }
        }

        let history: Vec<_> = grouped.into_values().collect();
        let mut by_token: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, row) in history.iter().enumerate() {
            for token in &row.tokens {
                by_token.entry(token.clone()).or_default().push(index);
            }
        }
        Self { history, by_token }
    }

    fn matching_rows(&self, tokens: &HashSet<String>) -> HashSet<usize> {
        tokens
            .iter()
            .filter_map(|token| self.by_token.get(token))
            .flatten()
            .copied()
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HistorySuggestion {
    pub category_id: String,
    pub category_name: Option<String>,
}

pub fn is_refund_description(description: &str) -> bool {
    let folded = fold_text(description);
    ["ESTORNO", "REEMBOLSO", "DEVOLUCAO", "CREDITO COMPRA"]
        .iter()
        .any(|term| folded.contains(term))
}

pub fn category_compatible(
    category_kind: &str,
    amount_in_cents: i64,
    context: SuggestionContext,
    is_refund: bool,
) -> bool {
    match (context, category_kind) {
        (SuggestionContext::Bank, "income") => amount_in_cents > 0,
        (SuggestionContext::Bank, "expense" | "investment") => amount_in_cents < 0 || is_refund,
        (SuggestionContext::CreditCard, "expense" | "investment") => true,
        // Transferências exigem uma regra/detecção explícita; nunca são atalhos heurísticos.
        (_, "transfer") | (SuggestionContext::CreditCard, "income") => false,
        _ => false,
    }
}

/// Chooses an automatic history suggestion. Explicit rules are evaluated before this function.
pub fn suggest_from_history(
    stats: &[MerchantCategoryStat],
    amount_in_cents: i64,
    context: SuggestionContext,
    is_refund: bool,
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
    if dominance < MIN_DOMINANCE_PERCENT
        || !category_compatible(&top.category_kind, amount_in_cents, context, is_refund)
    {
        return None;
    }
    Some(HistorySuggestion {
        category_id: top.category_id.clone(),
        category_name: top.category_name.clone(),
    })
}

/// Uppercases and folds Portuguese accents while preserving punctuation. Merchant normalization
/// uses this first so its date, installment and payment-prefix patterns can still see separators.
pub fn fold_accents(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_uppercase)
        .map(|character| match character {
            'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'A',
            'É' | 'È' | 'Ê' | 'Ë' => 'E',
            'Í' | 'Ì' | 'Î' | 'Ï' => 'I',
            'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'O',
            'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
            'Ç' => 'C',
            other => other,
        })
        .collect()
}

/// Accent-insensitive, punctuation-free normalization used only by the local suggestion engine.
pub fn fold_text(value: &str) -> String {
    fold_accents(value)
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn meaningful_tokens(value: &str) -> HashSet<String> {
    const STOP_WORDS: &[&str] = &[
        "PAG",
        "PAGAMENTO",
        "COMPRA",
        "CARTAO",
        "CREDITO",
        "DEBITO",
        "PIX",
        "TED",
        "DOC",
        "LTDA",
        "EIRELI",
        "BRASIL",
        "SERVICOS",
        "COMERCIO",
        "PARCELA",
        "PARC",
    ];
    fold_text(value)
        .split_whitespace()
        .filter(|token| {
            token.len() >= 3
                && !token.chars().all(|character| character.is_ascii_digit())
                && !STOP_WORDS.contains(token)
        })
        .map(String::from)
        .collect()
}

#[derive(Debug)]
struct IndexedVocabularyPhrase {
    category_id: &'static str,
    phrase: &'static str,
    tokens: Vec<String>,
    compact: String,
    order: usize,
}

struct VocabularySearchIndex {
    phrases: Vec<IndexedVocabularyPhrase>,
    by_anchor: HashMap<String, Vec<usize>>,
    by_compact: HashMap<String, Vec<usize>>,
}

impl VocabularySearchIndex {
    fn build() -> Self {
        let mut phrases = Vec::new();
        let mut by_anchor: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_compact: HashMap<String, Vec<usize>> = HashMap::new();

        for entry in PT_BR_CATEGORY_VOCABULARY {
            for phrase in entry.phrases {
                let tokens = fold_text(phrase)
                    .split_whitespace()
                    .map(String::from)
                    .collect::<Vec<_>>();
                if tokens.is_empty() {
                    continue;
                }
                let compact = tokens.concat();
                let anchor = tokens
                    .iter()
                    .max_by(|left, right| {
                        left.len().cmp(&right.len()).then_with(|| right.cmp(left))
                    })
                    .expect("non-empty vocabulary phrase")
                    .clone();
                let phrase_index = phrases.len();
                phrases.push(IndexedVocabularyPhrase {
                    category_id: entry.category_id,
                    phrase,
                    tokens,
                    compact: compact.clone(),
                    order: phrase_index,
                });
                by_anchor.entry(anchor).or_default().push(phrase_index);
                if compact.len() >= 8 {
                    by_compact.entry(compact).or_default().push(phrase_index);
                }
            }
        }

        Self {
            phrases,
            by_anchor,
            by_compact,
        }
    }

    fn matching_phrases(&self, description: &str) -> Vec<&IndexedVocabularyPhrase> {
        let tokens = canonical_search_tokens(description);
        if tokens.is_empty() {
            return Vec::new();
        }

        let mut candidates = HashSet::new();
        for token in &tokens {
            if let Some(indices) = self.by_anchor.get(token) {
                candidates.extend(indices.iter().copied());
            }
            let compact = collapse_repeated_compact_token(token);
            if let Some(indices) = self.by_compact.get(compact) {
                candidates.extend(indices.iter().copied());
            }
        }

        let mut matches = candidates
            .into_iter()
            .filter_map(|index| {
                let phrase = &self.phrases[index];
                let token_match = tokens
                    .windows(phrase.tokens.len())
                    .any(|window| window == phrase.tokens);
                let compact_match = phrase.compact.len() >= 8
                    && tokens.iter().any(|token| {
                        collapse_repeated_compact_token(token) == phrase.compact.as_str()
                    });
                (token_match || compact_match).then_some(phrase)
            })
            .collect::<Vec<_>>();

        matches.sort_by(|left, right| {
            let left_exact = left.tokens == tokens;
            let right_exact = right.tokens == tokens;
            right_exact
                .cmp(&left_exact)
                .then_with(|| right.tokens.len().cmp(&left.tokens.len()))
                .then_with(|| right.compact.len().cmp(&left.compact.len()))
                .then_with(|| left.order.cmp(&right.order))
        });
        matches
    }
}

fn vocabulary_search_index() -> &'static VocabularySearchIndex {
    static INDEX: OnceLock<VocabularySearchIndex> = OnceLock::new();
    INDEX.get_or_init(VocabularySearchIndex::build)
}

fn canonical_search_tokens(value: &str) -> Vec<String> {
    let tokens = fold_text(value)
        .split_whitespace()
        .map(String::from)
        .collect::<Vec<_>>();
    let mut canonical = Vec::with_capacity(tokens.len());
    let mut cursor = 0;
    while cursor < tokens.len() {
        let remaining = tokens.len() - cursor;
        let repeated_width = (1..=remaining / 2).find(|width| {
            let identity_size: usize = tokens[cursor..cursor + width].iter().map(String::len).sum();
            identity_size >= 8
                && tokens[cursor..cursor + width] == tokens[cursor + width..cursor + 2 * width]
        });
        if let Some(width) = repeated_width {
            canonical.extend_from_slice(&tokens[cursor..cursor + width]);
            cursor += width * 2;
            while cursor + width <= tokens.len()
                && tokens[cursor - width..cursor] == tokens[cursor..cursor + width]
            {
                cursor += width;
            }
        } else {
            canonical.push(tokens[cursor].clone());
            cursor += 1;
        }
    }
    canonical
}

fn collapse_repeated_compact_token(token: &str) -> &str {
    if !token.is_ascii() {
        return token;
    }
    for width in 4..=token.len() / 2 {
        if token.len().is_multiple_of(width) {
            let base = &token[..width];
            if token
                .as_bytes()
                .chunks(width)
                .all(|chunk| chunk == base.as_bytes())
            {
                return base;
            }
        }
    }
    token
}

#[derive(Debug)]
struct SimilarRank {
    category_id: String,
    category_name: String,
    similarity: usize,
    count: i64,
    last_used: String,
}

/// Produces up to three local, deterministic shortcuts. These are deliberately never applied
/// automatically; the caller stores them separately from `suggested_category_id`.
pub fn shortlist_categories(
    merchant_key: &str,
    description: &str,
    amount_in_cents: i64,
    context: SuggestionContext,
    is_refund: bool,
    categories: &[CategoryDefinition],
    index: &SuggestionIndex,
) -> Vec<CategorySuggestion> {
    let category_map: HashMap<&str, &CategoryDefinition> = categories
        .iter()
        .map(|category| (category.id.as_str(), category))
        .collect();
    let candidate_tokens = meaningful_tokens(merchant_key);
    let mut similar_by_category: HashMap<String, SimilarRank> = HashMap::new();

    if !candidate_tokens.is_empty() {
        for row_index in index.matching_rows(&candidate_tokens) {
            let row = &index.history[row_index];
            if !category_compatible(&row.category_kind, amount_in_cents, context, is_refund)
                || !category_map.contains_key(row.category_id.as_str())
            {
                continue;
            }
            let history_tokens = &row.tokens;
            if history_tokens.is_empty() {
                continue;
            }
            let overlap = candidate_tokens.intersection(history_tokens).count();
            let denominator = candidate_tokens.len().min(history_tokens.len());
            if overlap == 0 || overlap * 2 < denominator {
                continue;
            }
            let similarity = overlap * 100 / denominator;
            let rank = similar_by_category
                .entry(row.category_id.clone())
                .or_insert_with(|| SimilarRank {
                    category_id: row.category_id.clone(),
                    category_name: row.category_name.clone(),
                    similarity,
                    count: 0,
                    last_used: row.last_used.clone(),
                });
            rank.count += row.count;
            if similarity > rank.similarity {
                rank.similarity = similarity;
            }
            if row.last_used > rank.last_used {
                rank.last_used = row.last_used.clone();
            }
        }
    }

    let mut similar: Vec<_> = similar_by_category.into_values().collect();
    similar.sort_by(|left, right| {
        right
            .similarity
            .cmp(&left.similarity)
            .then_with(|| right.count.cmp(&left.count))
            .then_with(|| right.last_used.cmp(&left.last_used))
            .then_with(|| left.category_name.cmp(&right.category_name))
            .then_with(|| left.category_id.cmp(&right.category_id))
    });

    let mut result = Vec::with_capacity(3);
    let mut seen = HashSet::new();
    for rank in similar {
        if result.len() == 3 {
            return result;
        }
        if seen.insert(rank.category_id.clone()) {
            result.push(CategorySuggestion {
                category_id: rank.category_id,
                category_name: rank.category_name,
                source: CategorySuggestionSource::SimilarHistory,
                reason: "Usada em estabelecimentos parecidos".into(),
            });
        }
    }

    let folded_description = fold_text(description);
    let mut by_name: Vec<_> = categories
        .iter()
        .filter(|category| {
            category_compatible(&category.kind, amount_in_cents, context, is_refund)
                && !seen.contains(&category.id)
                && {
                    let name = fold_text(&category.name);
                    name.len() >= 4 && contains_phrase(&folded_description, &name)
                }
        })
        .collect();
    by_name.sort_by_key(|category| category.sort_order);
    for category in by_name {
        if result.len() == 3 {
            return result;
        }
        seen.insert(category.id.clone());
        result.push(CategorySuggestion {
            category_id: category.id.clone(),
            category_name: category.name.clone(),
            source: CategorySuggestionSource::CategoryName,
            reason: "O nome aparece na descrição".into(),
        });
    }

    for phrase in vocabulary_search_index().matching_phrases(description) {
        if result.len() == 3 {
            break;
        }
        let Some(category) = category_map.get(phrase.category_id) else {
            continue;
        };
        if seen.contains(&category.id)
            || !category_compatible(&category.kind, amount_in_cents, context, is_refund)
        {
            continue;
        }
        if !generic_vocabulary_match_allowed(phrase.category_id, phrase.phrase, &folded_description)
        {
            continue;
        }
        seen.insert(category.id.clone());
        result.push(CategorySuggestion {
            category_id: category.id.clone(),
            category_name: category.name.clone(),
            source: CategorySuggestionSource::Vocabulary,
            reason: format!("Descrição lembra {}", phrase.phrase),
        });
    }
    result
}

fn contains_phrase(text: &str, phrase: &str) -> bool {
    text.match_indices(phrase).any(|(start, matched)| {
        let end = start + matched.len();
        (start == 0 || text.as_bytes()[start - 1] == b' ')
            && (end == text.len() || text.as_bytes()[end] == b' ')
    })
}

fn generic_vocabulary_match_allowed(category_id: &str, phrase: &str, description: &str) -> bool {
    let blocked_contexts: &[&str] = match (category_id, phrase) {
        ("fuel", "POSTO") => &[
            "POSTO DE ATENDIMENTO",
            "POSTO BANCARIO",
            "POSTO DE SAUDE",
            "POSTO FISCAL",
        ],
        ("insurance", "SEGURO") => &[
            "PAGAMENTO SEGURO",
            "SITE SEGURO",
            "AMBIENTE SEGURO",
            "COMPRA SEGURA",
            "CONEXAO SEGURA",
        ],
        _ => &[],
    };

    !blocked_contexts
        .iter()
        .any(|blocked| contains_phrase(description, blocked))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

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

    fn category(id: &str, name: &str, kind: &str, sort_order: i64) -> CategoryDefinition {
        CategoryDefinition {
            id: id.into(),
            name: name.into(),
            kind: kind.into(),
            sort_order,
        }
    }

    #[test]
    fn suggests_when_dominant_and_frequent_enough() {
        let stats = vec![stat("groceries", "expense", 3, "2026-06-01")];
        assert_eq!(
            suggest_from_history(&stats, -5000, SuggestionContext::Bank, false)
                .unwrap()
                .category_id,
            "groceries"
        );
    }

    #[test]
    fn refuses_weak_split_or_incompatible_history() {
        assert!(suggest_from_history(
            &[stat("groceries", "expense", 1, "2026-06-01")],
            -5000,
            SuggestionContext::Bank,
            false
        )
        .is_none());
        assert!(suggest_from_history(
            &[
                stat("groceries", "expense", 3, "2026-06-01"),
                stat("restaurants", "expense", 2, "2026-06-05"),
            ],
            -5000,
            SuggestionContext::Bank,
            false
        )
        .is_none());
        assert!(suggest_from_history(
            &[stat("groceries", "expense", 3, "2026-06-01")],
            5000,
            SuggestionContext::Bank,
            false
        )
        .is_none());
    }

    #[test]
    fn card_credit_can_reuse_an_expense_category() {
        let stats = vec![stat("groceries", "expense", 3, "2026-06-01")];
        assert!(suggest_from_history(&stats, 5000, SuggestionContext::CreditCard, false).is_some());
        assert!(suggest_from_history(
            &[stat("salary", "income", 3, "2026-06-01")],
            5000,
            SuggestionContext::CreditCard,
            false
        )
        .is_none());
    }

    #[test]
    fn accent_insensitive_vocabulary_suggests_without_preselecting() {
        let categories = vec![category("health", "Saúde", "expense", 1)];
        let history = vec![];
        let index = SuggestionIndex::new(&history);
        let choices = shortlist_categories(
            "FARMACIA SAO JOAO",
            "Farmácia São João",
            -2500,
            SuggestionContext::Bank,
            false,
            &categories,
            &index,
        );
        assert_eq!(choices[0].category_id, "health");
        assert_eq!(choices[0].source, CategorySuggestionSource::Vocabulary);
    }

    #[test]
    fn marketplace_descriptors_match_punctuation_repetition_and_compact_forms() {
        let categories = vec![category("shopping", "Compras", "expense", 1)];
        let index = SuggestionIndex::new(&[]);

        for description in [
            "MERCADO LIVRE*MERCADO LIVRE",
            "MERCADO LIVRE * MERCADO LIVRE",
            "MERCADOLIVRE*LOJA OFICIAL",
            "MERCADOLIVREMERCADOLIVRE",
        ] {
            let choices = shortlist_categories(
                description,
                description,
                -2500,
                SuggestionContext::Bank,
                false,
                &categories,
                &index,
            );
            assert_eq!(
                choices.first().map(|choice| choice.category_id.as_str()),
                Some("shopping"),
                "marketplace descriptor did not match: {description}"
            );
            assert_eq!(choices[0].source, CategorySuggestionSource::Vocabulary);
        }
    }

    #[test]
    fn marketplace_shortcut_respects_direction_and_does_not_classify_payment_processor() {
        let categories = vec![
            category("shopping", "Compras", "expense", 1),
            category("restaurants", "Restaurantes", "expense", 2),
        ];
        let index = SuggestionIndex::new(&[]);

        assert!(shortlist_categories(
            "MERCADO LIVRE",
            "MERCADO LIVRE",
            2500,
            SuggestionContext::Bank,
            false,
            &categories,
            &index,
        )
        .is_empty());
        assert_eq!(
            shortlist_categories(
                "MERCADO LIVRE",
                "ESTORNO MERCADO LIVRE",
                2500,
                SuggestionContext::CreditCard,
                true,
                &categories,
                &index,
            )[0]
            .category_id,
            "shopping"
        );
        for description in ["MERCADO PAGO", "MERCADOPAGO", "MP PAGAMENTO"] {
            assert!(
                shortlist_categories(
                    description,
                    description,
                    -2500,
                    SuggestionContext::Bank,
                    false,
                    &categories,
                    &index,
                )
                .is_empty(),
                "payment processor must not imply a purchase category: {description}"
            );
        }
    }

    #[test]
    fn similar_personal_history_outranks_generic_vocabulary() {
        let categories = vec![
            category("custom-coffee", "Cafés", "expense", 1),
            category("restaurants", "Restaurantes", "expense", 2),
        ];
        let history = vec![HistoricalCategoryStat {
            merchant_key: "CAFE CENTRAL".into(),
            category_id: "custom-coffee".into(),
            category_name: "Cafés".into(),
            category_kind: "expense".into(),
            count: 2,
            last_used: "2026-06-01".into(),
        }];
        let index = SuggestionIndex::new(&history);
        let choices = shortlist_categories(
            "CAFE CENTRAL UNIDADE",
            "Café Central Unidade 2",
            -1800,
            SuggestionContext::Bank,
            false,
            &categories,
            &index,
        );
        assert_eq!(choices[0].category_id, "custom-coffee");
        assert_eq!(choices[0].source, CategorySuggestionSource::SimilarHistory);
    }

    #[test]
    fn transfer_categories_are_never_shortlisted() {
        let categories = vec![category("transfers", "Transferências", "transfer", 1)];
        let history = vec![];
        let index = SuggestionIndex::new(&history);
        assert!(shortlist_categories(
            "TRANSFERENCIA",
            "Transferência recebida",
            1000,
            SuggestionContext::Bank,
            false,
            &categories,
            &index
        )
        .is_empty());
    }

    #[test]
    fn vocabulary_matches_token_boundaries() {
        let categories = vec![
            category("fuel", "Combustível", "expense", 1),
            category("education", "Educação", "expense", 2),
        ];
        let history = vec![];
        let index = SuggestionIndex::new(&history);
        for description in ["IMPOSTO MUNICIPAL", "RECURSO ADMINISTRATIVO"] {
            assert!(shortlist_categories(
                description,
                description,
                -1000,
                SuggestionContext::Bank,
                false,
                &categories,
                &index,
            )
            .is_empty());
        }
    }

    #[test]
    fn brazilian_brands_and_services_cover_distinct_seed_categories() {
        let categories = vec![
            category("subscriptions", "Assinaturas", "expense", 1),
            category("shopping", "Compras", "expense", 2),
            category("groceries", "Supermercado", "expense", 3),
            category("restaurants", "Restaurantes", "expense", 4),
            category("fuel", "Combustível", "expense", 5),
            category("public-transport", "Transporte público", "expense", 6),
            category("apps", "Transporte por aplicativo", "expense", 7),
            category("transport", "Transporte", "expense", 8),
            category("utilities", "Água, luz e gás", "expense", 9),
            category("housing", "Moradia", "expense", 10),
            category("health", "Saúde", "expense", 11),
            category("education", "Educação", "expense", 12),
            category("personal-care", "Cuidados pessoais", "expense", 13),
            category("insurance", "Seguros", "expense", 14),
            category("bank-fees", "Tarifas bancárias", "expense", 15),
            category("taxes", "Impostos", "expense", 16),
            category("investments", "Investimentos", "investment", 17),
            category("leisure", "Lazer", "expense", 18),
            category("salary", "Salário", "income", 19),
            category("other-income", "Outras receitas", "income", 20),
        ];
        let history = vec![];
        let index = SuggestionIndex::new(&history);
        let cases = [
            ("AMAZON PRIME VIDEO", -3990, "subscriptions"),
            ("COMPRA MAGALU", -12000, "shopping"),
            ("TIKTOK SHOP PEDIDO", -8900, "shopping"),
            ("ASSAI ATACADISTA LOJA 123", -23550, "groceries"),
            ("IFOOD PEDIDO 9988", -4890, "restaurants"),
            ("PANIFICADORA CENTRAL", -2490, "restaurants"),
            ("POSTO IPIRANGA", -25000, "fuel"),
            ("RECARGA BILHETE UNICO", -5000, "public-transport"),
            ("UBER TRIP SAO PAULO", -2790, "apps"),
            ("SEM PARAR MENSALIDADE", -3590, "transport"),
            ("CEMIG DISTRIBUICAO", -18840, "utilities"),
            ("LEROY MERLIN", -49990, "housing"),
            ("DROGASIL 1234", -6780, "health"),
            ("ALURA CURSOS ONLINE", -9900, "education"),
            ("O BOTICARIO LOJA", -7600, "personal-care"),
            ("TOKIO MARINE SEGURADORA", -14500, "insurance"),
            ("CESTA DE SERVICOS", -3500, "bank-fees"),
            ("DARF RECEITA FEDERAL", -72000, "taxes"),
            ("XP INVESTIMENTOS APLICACAO", -100000, "investments"),
            ("CINEMARK INGRESSO", -5200, "leisure"),
            ("CREDITO SALARIO EMPRESA", 500000, "salary"),
            ("RESTITUICAO IRPF", 45000, "other-income"),
        ];

        for (description, amount, expected) in cases {
            let choices = shortlist_categories(
                description,
                description,
                amount,
                SuggestionContext::Bank,
                false,
                &categories,
                &index,
            );
            assert_eq!(
                choices.first().map(|choice| choice.category_id.as_str()),
                Some(expected),
                "unexpected first suggestion for {description}"
            );
        }
    }

    #[test]
    fn vocabulary_avoids_generic_financial_and_language_false_positives() {
        let categories = vec![
            category("fuel", "Combustível", "expense", 1),
            category("education", "Educação", "expense", 2),
            category("insurance", "Seguros", "expense", 3),
            category("investments", "Investimentos", "investment", 4),
            category("subscriptions", "Assinaturas", "expense", 5),
            category("transfers", "Transferências", "transfer", 6),
        ];
        let history = vec![];
        let index = SuggestionIndex::new(&history);

        for description in [
            "POSTO DE ATENDIMENTO BANCARIO",
            "RECURSO ADMINISTRATIVO",
            "PAGAMENTO SEGURO DA COMPRA",
            "APLICACAO DE PROVA ESCOLAR",
            "STREAMING DE DADOS CORPORATIVOS",
            "TRANSFERENCIA RECEBIDA",
        ] {
            assert!(
                shortlist_categories(
                    description,
                    description,
                    -1000,
                    SuggestionContext::Bank,
                    false,
                    &categories,
                    &index,
                )
                .is_empty(),
                "generic text must not create a shortcut: {description}"
            );
        }
    }

    #[test]
    fn brazilian_genre_tags_create_shortcuts_in_safe_contexts() {
        let categories = vec![
            category("restaurants", "Restaurantes", "expense", 1),
            category("fuel", "Combustível", "expense", 2),
            category("health", "Saúde", "expense", 3),
            category("education", "Educação", "expense", 4),
            category("insurance", "Seguros", "expense", 5),
            category("leisure", "Lazer", "expense", 6),
        ];
        let index = SuggestionIndex::new(&[]);
        let cases = [
            ("RESTAURANTE DA PRACA", "restaurants"),
            ("PADARIA CENTRAL", "restaurants"),
            ("POSTO AVENIDA", "fuel"),
            ("CLINICA DO BAIRRO", "health"),
            ("ESCOLA NOVO TEMPO", "education"),
            ("SEGURO MENSAL", "insurance"),
            ("CINEMA SHOPPING", "leisure"),
        ];

        for (description, expected) in cases {
            let choices = shortlist_categories(
                description,
                description,
                -1000,
                SuggestionContext::Bank,
                false,
                &categories,
                &index,
            );
            assert_eq!(
                choices.first().map(|choice| choice.category_id.as_str()),
                Some(expected),
                "genre tag did not classify {description}"
            );
        }
    }

    #[test]
    fn vocabulary_respects_direction_and_refund_signals() {
        let categories = vec![
            category("health", "Saúde", "expense", 1),
            category("salary", "Salário", "income", 2),
        ];
        let index = SuggestionIndex::new(&[]);

        // A normal positive credit cannot use an expense shortcut, even when the description
        // contains a high-precision pharmacy brand.
        assert!(shortlist_categories(
            "DROGASIL",
            "DROGASIL",
            6800,
            SuggestionContext::Bank,
            false,
            &categories,
            &index,
        )
        .is_empty());

        // A refund/credit may reuse the original expense category when the description provides
        // explicit refund evidence. This is deliberately separate from salary/other income.
        let choices = shortlist_categories(
            "DROGASIL",
            "ESTORNO DROGASIL",
            6800,
            SuggestionContext::Bank,
            true,
            &categories,
            &index,
        );
        assert_eq!(
            choices.first().map(|choice| choice.category_id.as_str()),
            Some("health")
        );
    }

    #[test]
    fn vocabulary_shortlist_is_bounded_unique_and_ignores_archived_categories() {
        // The caller supplies only active categories. A vocabulary entry whose category is not
        // present must not leak into the shortlist (archived/deleted categories are omitted by
        // the database query).
        let categories = vec![
            category("shopping", "Compras", "expense", 1),
            category("restaurants", "Restaurantes", "expense", 2),
            category("health", "Saúde", "expense", 3),
        ];
        let index = SuggestionIndex::new(&[]);
        let choices = shortlist_categories(
            "AMAZON PRIME VIDEO",
            "AMAZON PRIME VIDEO NETFLIX SPOTIFY DROGASIL IFOOD",
            -3000,
            SuggestionContext::Bank,
            false,
            &categories,
            &index,
        );

        assert!(choices.len() <= 3);
        let ids: HashSet<_> = choices
            .iter()
            .map(|choice| choice.category_id.as_str())
            .collect();
        assert_eq!(ids.len(), choices.len());
        assert!(choices.iter().all(|choice| {
            categories
                .iter()
                .any(|category| category.id == choice.category_id)
        }));
    }
}
