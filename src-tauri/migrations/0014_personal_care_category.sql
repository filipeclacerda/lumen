-- Adiciona a categoria "Cuidados pessoais" como despesa discricionária,
-- entre Compras (90) e Lazer (100). O bloco administrativo permanece intacto.

INSERT OR IGNORE INTO categories(id,parent_id,name,color,icon,kind,sort_order,is_system)
VALUES ('personal-care',NULL,'Cuidados pessoais','#c97f9e','sparkles','expense',95,1);
