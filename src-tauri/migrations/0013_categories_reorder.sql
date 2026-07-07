-- Reordenar e reafiliar categorias por tipo (receita, despesa, investimento, transferência).
-- Sub-categorias ficam imediatamente abaixo do pai em sortOrder.

-- Receitas
UPDATE categories SET sort_order = 10 WHERE id = 'income';
UPDATE categories SET sort_order = 11 WHERE id = 'salary';
UPDATE categories SET sort_order = 12 WHERE id = 'other-income';

-- Despesas essenciais
UPDATE categories SET parent_id = NULL, sort_order = 20 WHERE id = 'food';
UPDATE categories SET sort_order = 21 WHERE id = 'groceries';
UPDATE categories SET sort_order = 22 WHERE id = 'restaurants';

UPDATE categories SET sort_order = 30 WHERE id = 'housing';
UPDATE categories SET sort_order = 31 WHERE id = 'rent';
UPDATE categories SET sort_order = 32 WHERE id = 'utilities';

UPDATE categories SET sort_order = 40 WHERE id = 'transport';
UPDATE categories SET sort_order = 41 WHERE id = 'fuel';
UPDATE categories SET sort_order = 42 WHERE id = 'public-transport';

UPDATE categories SET sort_order = 50 WHERE id = 'health';
UPDATE categories SET sort_order = 60 WHERE id = 'education';
UPDATE categories SET sort_order = 70 WHERE id = 'insurance';
UPDATE categories SET sort_order = 80 WHERE id = 'taxes';

-- Despesas discricionárias
UPDATE categories SET sort_order = 90 WHERE id = 'shopping';
UPDATE categories SET sort_order = 100 WHERE id = 'leisure';

-- Assinaturas passa a ser sub-categoria de Lazer
UPDATE categories SET parent_id = 'leisure', sort_order = 101 WHERE id = 'subscriptions';

-- "Aplicativos" é renomeado para "Transporte por aplicativo" e afiliado a Transporte
UPDATE categories SET name = 'Transporte por aplicativo', parent_id = 'transport', icon = 'car', color = '#9165a4', sort_order = 43 WHERE id = 'apps';

-- Bloco administrativo / transferências / investimentos
UPDATE categories SET sort_order = 110 WHERE id = 'bank-fees';
UPDATE categories SET sort_order = 120 WHERE id = 'transfers';
UPDATE categories SET sort_order = 121 WHERE id = 'credit-card-payment';
UPDATE categories SET sort_order = 130 WHERE id = 'investments';
