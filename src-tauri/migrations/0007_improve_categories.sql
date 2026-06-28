-- Update root categories to group them logically
UPDATE categories SET name = 'Moradia', sort_order = 20 WHERE id = 'housing';
UPDATE categories SET name = 'Alimentação', sort_order = 30 WHERE id = 'food';
UPDATE categories SET name = 'Transporte', sort_order = 40 WHERE id = 'transport';
UPDATE categories SET name = 'Saúde', sort_order = 50 WHERE id = 'health';
UPDATE categories SET name = 'Educação', sort_order = 60 WHERE id = 'education';
UPDATE categories SET name = 'Seguros', sort_order = 70 WHERE id = 'insurance';
UPDATE categories SET name = 'Impostos', sort_order = 80 WHERE id = 'taxes';
UPDATE categories SET name = 'Compras', sort_order = 90 WHERE id = 'shopping';
UPDATE categories SET name = 'Lazer', sort_order = 100 WHERE id = 'leisure';
UPDATE categories SET name = 'Receitas', sort_order = 10 WHERE id = 'income';

-- Update sub-categories
UPDATE categories SET name = 'Salário', sort_order = 11 WHERE id = 'salary';
UPDATE categories SET name = 'Outras receitas', sort_order = 12 WHERE id = 'other-income';

UPDATE categories SET name = 'Aluguel e condomínio', sort_order = 21 WHERE id = 'rent';
UPDATE categories SET name = 'Água, luz e gás', sort_order = 22 WHERE id = 'utilities';

UPDATE categories SET name = 'Supermercado', sort_order = 31 WHERE id = 'groceries';
UPDATE categories SET name = 'Restaurantes', sort_order = 32 WHERE id = 'restaurants';

UPDATE categories SET name = 'Combustível', sort_order = 41 WHERE id = 'fuel';
UPDATE categories SET name = 'Transporte público', sort_order = 42 WHERE id = 'public-transport';

UPDATE categories SET name = 'Tarifas bancárias', sort_order = 130 WHERE id = 'bank-fees';
UPDATE categories SET name = 'Transferências', sort_order = 140 WHERE id = 'transfers';
UPDATE categories SET name = 'Pagamento de fatura', sort_order = 150 WHERE id = 'credit-card-payment';

-- Insert new categories
INSERT OR IGNORE INTO categories(id, parent_id, name, color, icon, kind, sort_order, is_system) 
VALUES
('subscriptions', NULL, 'Assinaturas', '#e55a73', 'play', 'expense', 110, 1),
('apps', NULL, 'Aplicativos', '#f0a14a', 'smartphone', 'expense', 120, 1);
