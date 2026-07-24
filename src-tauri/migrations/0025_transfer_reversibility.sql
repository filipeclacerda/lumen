-- Guarda também a categorização anterior da perna de crédito para permitir
-- desfazer um vínculo de transferência sem perder a decisão do usuário.
ALTER TABLE transaction_links
ADD COLUMN previous_credit_category_id TEXT REFERENCES categories(id);

ALTER TABLE transaction_links
ADD COLUMN previous_credit_category_source TEXT;

ALTER TABLE transaction_links
ADD COLUMN previous_credit_rule_id TEXT REFERENCES categorization_rules(id);
