ALTER TABLE categories ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense';
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN deleted_at TEXT;

UPDATE categories SET kind = 'income', is_system = 1 WHERE id = 'income';
UPDATE categories SET is_system = 1 WHERE id IN ('food','housing','transport','health','leisure');

ALTER TABLE transactions ADD COLUMN category_source TEXT;
ALTER TABLE transactions ADD COLUMN categorization_rule_id TEXT;

CREATE TABLE categorization_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  operator TEXT NOT NULL CHECK(operator IN ('contains','starts_with','regex')),
  pattern TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  movement_type TEXT NOT NULL DEFAULT 'any' CHECK(movement_type IN ('any','income','expense','transfer')),
  min_amount_cents INTEGER,
  max_amount_cents INTEGER,
  category_id TEXT NOT NULL REFERENCES categories(id),
  use_count INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX categorization_rules_priority ON categorization_rules(enabled, priority) WHERE deleted_at IS NULL;
CREATE INDEX transactions_category_source ON transactions(category_source);

INSERT OR IGNORE INTO categories(id,parent_id,name,color,icon,kind,sort_order,is_system) VALUES
 ('salary','income','Salário','#22835f','wallet','income',10,1),
 ('other-income','income','Outras receitas','#4d9b7f','circle-plus','income',20,1),
 ('groceries','food','Supermercado','#e5a142','shopping-basket','expense',30,1),
 ('restaurants','food','Restaurantes e delivery','#d88b38','utensils','expense',40,1),
 ('utilities','housing','Água, luz e gás','#728bba','lightbulb','expense',50,1),
 ('rent','housing','Aluguel e condomínio','#657cad','house','expense',60,1),
 ('fuel','transport','Combustível','#a778ba','fuel','expense',70,1),
 ('public-transport','transport','Transporte público e apps','#9165a4','bus','expense',80,1),
 ('education',NULL,'Educação','#497ca5','graduation-cap','expense',90,1),
 ('shopping',NULL,'Compras','#b06f91','shopping-bag','expense',100,1),
 ('taxes',NULL,'Impostos','#9c7661','landmark','expense',110,1),
 ('insurance',NULL,'Seguros','#568a91','shield','expense',120,1),
 ('bank-fees',NULL,'Tarifas bancárias','#8a8078','receipt','expense',130,1),
 ('transfers',NULL,'Transferências','#6d7d78','arrow-left-right','transfer',140,1),
 ('credit-card-payment','transfers','Pagamento de fatura','#596d67','credit-card','transfer',150,1);

INSERT OR IGNORE INTO categorization_rules
  (id,name,priority,operator,pattern,movement_type,category_id,is_system)
VALUES
 ('default-salary','Salário identificado',1000,'contains','SALARIO','income','salary',1),
 ('default-supermarket','Supermercado',1010,'contains','SUPERMERC','expense','groceries',1),
 ('default-fuel','Posto de combustível',1020,'contains','POSTO ','expense','fuel',1),
 ('default-energy','Energia elétrica',1030,'contains','ENERGIA','expense','utilities',1),
 ('default-bank-package','Pacote de serviços bancários',1040,'contains','PACOTE SERVI','expense','bank-fees',1),
 ('default-bank-fee','Tarifa bancária',1050,'contains','TARIFA','expense','bank-fees',1),
 ('default-insurance','Seguro prestamista',1060,'contains','SEG.PRESTAMISTA','expense','insurance',1),
 ('default-card-payment','Pagamento de cartão',1070,'contains','PAGAMENTO DE CARTÃO DE CRÉDITO','expense','credit-card-payment',1),
 ('default-shein','Compras Shein',1080,'contains','SHEIN','expense','shopping',1);
