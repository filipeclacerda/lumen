-- Adiciona categorias de sistema para contas recorrentes de telecomunicações e
-- despesas que não se encaixam nas categorias específicas existentes.

INSERT OR IGNORE INTO categories(id,parent_id,name,color,icon,kind,sort_order,is_system)
VALUES
  ('bills',NULL,'Contas','#728bba','receipt','expense',35,1),
  ('other-expenses',NULL,'Outras Despesas','#8a8078','tag','expense',115,1);
