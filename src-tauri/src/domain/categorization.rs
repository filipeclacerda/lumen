use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RuleOperator { Contains, StartsWith, Regex }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MovementType { Any, Income, Expense, Transfer }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorizationRule {
    pub id: String,
    pub name: String,
    pub priority: i64,
    pub enabled: bool,
    pub operator: RuleOperator,
    pub pattern: String,
    pub account_id: Option<String>,
    pub movement_type: MovementType,
    pub min_amount_in_cents: Option<i64>,
    pub max_amount_in_cents: Option<i64>,
    pub category_id: String,
    pub category_name: Option<String>,
    pub use_count: i64,
    pub is_system: bool,
}

pub struct CategorizationInput<'a> {
    pub account_id: &'a str,
    pub normalized_description: &'a str,
    pub amount_in_cents: i64,
}

pub fn matches_rule(rule: &CategorizationRule, input: &CategorizationInput<'_>) -> bool {
    if !rule.enabled || rule.pattern.trim().is_empty() { return false; }
    if rule.account_id.as_ref().is_some_and(|id| id != input.account_id) { return false; }
    let actual = if input.amount_in_cents >= 0 { MovementType::Income } else { MovementType::Expense };
    if rule.movement_type != MovementType::Any && rule.movement_type != MovementType::Transfer && rule.movement_type != actual { return false; }
    let absolute = input.amount_in_cents.unsigned_abs() as i64;
    if rule.min_amount_in_cents.is_some_and(|min| absolute < min)
        || rule.max_amount_in_cents.is_some_and(|max| absolute > max) { return false; }
    let pattern = rule.pattern.to_uppercase();
    match rule.operator {
        RuleOperator::Contains => input.normalized_description.contains(&pattern),
        RuleOperator::StartsWith => input.normalized_description.starts_with(&pattern),
        RuleOperator::Regex => RegexBuilder::new(&rule.pattern).case_insensitive(true).build()
            .is_ok_and(|regex| regex.is_match(input.normalized_description)),
    }
}

pub fn first_match<'a>(rules: &'a [CategorizationRule], input: &CategorizationInput<'_>) -> Option<&'a CategorizationRule> {
    rules.iter().filter(|rule| matches_rule(rule, input)).min_by_key(|rule| rule.priority)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rule(operator: RuleOperator, movement_type: MovementType) -> CategorizationRule {
        CategorizationRule { id:"rule".into(),name:"Teste".into(),priority:100,enabled:true,operator,
            pattern:"MERCADO".into(),account_id:None,movement_type,min_amount_in_cents:None,
            max_amount_in_cents:None,category_id:"food".into(),category_name:None,use_count:0,is_system:false }
    }
    #[test] fn combines_conditions() {
        let mut r=rule(RuleOperator::Contains,MovementType::Expense); r.min_amount_in_cents=Some(1000); r.max_amount_in_cents=Some(5000);
        assert!(matches_rule(&r,&CategorizationInput{account_id:"a",normalized_description:"MERCADO CENTRAL",amount_in_cents:-2500}));
        assert!(!matches_rule(&r,&CategorizationInput{account_id:"a",normalized_description:"MERCADO CENTRAL",amount_in_cents:-800}));
    }
    #[test] fn respects_priority_and_disabled() {
        let mut later=rule(RuleOperator::Contains,MovementType::Expense); later.id="later".into(); later.priority=20;
        let mut first=later.clone(); first.id="first".into(); first.priority=10;
        let input=CategorizationInput{account_id:"a",normalized_description:"MERCADO",amount_in_cents:-100};
        assert_eq!(first_match(&[later.clone(),first.clone()],&input).unwrap().id,"first");
        first.enabled=false; assert_eq!(first_match(&[later,first],&input).unwrap().id,"later");
    }
    #[test] fn supports_starts_with_and_regex() {
        let input=CategorizationInput{account_id:"a",normalized_description:"POSTO CENTRAL",amount_in_cents:-100};
        let mut r=rule(RuleOperator::StartsWith,MovementType::Any); r.pattern="POSTO".into(); assert!(matches_rule(&r,&input));
        r.operator=RuleOperator::Regex; r.pattern=r"^POSTO\s+\w+".into(); assert!(matches_rule(&r,&input));
        r.pattern="(".into(); assert!(!matches_rule(&r,&input));
    }
    #[test] fn generic_pix_does_not_match() {
        assert!(!matches_rule(&rule(RuleOperator::Contains,MovementType::Expense),
            &CategorizationInput{account_id:"a",normalized_description:"PIX EMIT.OUTRA IF",amount_in_cents:-100}));
    }
}
