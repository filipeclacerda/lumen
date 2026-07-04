# Plano de Execução — Fase 3: Inteligência Local

> Escopo (do [PLANO_MELHORIAS.md](PLANO_MELHORIAS.md)): normalização de descrições (5), sugestão de categoria por histórico (1.3), detecção de assinaturas (4.2), detecção de anomalias (4.2) e resumo mensal narrado (4.2).
>
> Princípio inegociável: **tudo roda localmente**, em SQL + Rust puro. Nenhuma chamada externa, nenhum modelo de ML — heurísticas transparentes que o usuário consegue entender e auditar.

---

## Visão geral e ordem de execução

As etapas têm dependência real entre si — a normalização é a fundação de todo o resto:

```
Etapa 1: Normalização + estabelecimentos (merchants)
   ├─→ Etapa 2: Sugestão de categoria por histórico
   ├─→ Etapa 3: Detecção de assinaturas
   └─→ Etapa 4: Detecção de anomalias (independe de merchant, mas usa categoria)
            └─→ Etapa 5: Resumo mensal "Seu mês em números" (consome 3 e 4)
```

| Etapa | Esforço relativo | Risco | Entrega isolada? |
|-------|------------------|-------|------------------|
| 1. Normalização + merchants | M | Baixo | Sim — melhora imediata no "Top estabelecimentos" |
| 2. Sugestão por histórico | M | Médio (falsos positivos) | Sim |
| 3. Assinaturas | M | Baixo | Sim |
| 4. Anomalias | P | Baixo | Sim |
| 5. Resumo mensal | M | Baixo | Não — depende de 3 e 4 |

Cada etapa fecha com testes de backend passando (`cargo test`), `tsc -b` limpo e verificação visual. São 5 PRs/commits independentes, na ordem acima.

---

## Etapa 1 — Normalização de descrições e estabelecimentos

**Problema hoje:** `normalize_description` ([domain/import.rs:97](../src-tauri/src/domain/import.rs)) só faz uppercase + colapso de espaços. "PAG*JOSESILVA", "COMPRA CARTAO 1234 SUPERMERCADO BH 03/10" e "SUPERMERCADO BH LTDA" viram descrições diferentes, o que quebra o agrupamento do "Principais estabelecimentos" (`merchant_map` em [reports.rs](../src-tauri/src/commands/reports.rs) agrupa por `description` crua) e limitará as etapas 2 e 3.

### 1.1 Modelo de dados — migração `0012_merchants.sql`

```sql
ALTER TABLE transactions ADD COLUMN merchant_key TEXT;
CREATE INDEX transactions_merchant ON transactions(merchant_key) WHERE merchant_key IS NOT NULL;

-- Dicionário editável de apelidos: merchant_key bruto -> nome amigável
CREATE TABLE merchant_aliases (
  id TEXT PRIMARY KEY,
  merchant_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`merchant_key` é derivado (cache), nunca fonte de verdade — pode ser recalculado a qualquer momento a partir de `description`.

### 1.2 Algoritmo — novo módulo `domain/merchant.rs`

`pub fn merchant_key(description: &str) -> String`, pipeline determinístico sobre a descrição já normalizada:

1. Remover prefixos de meio de pagamento: `PAG*`, `PG *`, `PAGSEGURO*`, `MP *`, `MERCADOPAGO*`, `PIX QRS`, `COMPRA CARTAO`, `COMPRA COM CARTAO`, `DEB AUT`, `TED`, `DOC` (lista em constante, fácil de estender).
2. Remover sufixo de parcela: regex `\b\d{1,2}/\d{1,2}\b` no fim ("03/10").
3. Remover datas, horários e números longos (≥5 dígitos — nº de cartão/autorização/NSU).
4. Remover sufixos societários: `LTDA`, `SA`, `S A`, `ME`, `EIRELI`, `EPP`.
5. Colapsar espaços de novo; se sobrar string vazia, cair de volta para a descrição normalizada original (nunca retornar chave vazia).

**Regra de ouro dos testes:** cada transformação tem um caso de teste com entrada real brasileira (Sicoob/Nubank/Inter), incluindo os exemplos acima. É código de regex — o teste é a especificação.

### 1.3 Backend

- **Preenchimento**: `create_transaction_impl`, `create_transfer_impl`, `commit_import`, `commit_credit_card_import` e o gerador de recorrências passam a gravar `merchant_key` no INSERT.
- **Backfill**: a migração não consegue rodar Rust, então criar comando `backfill_merchant_keys` chamado uma vez no `setup` do `lib.rs` (idempotente: `WHERE merchant_key IS NULL`, em lotes de 500 para não travar a abertura).
- **CRUD de apelidos**: `list_merchant_aliases`, `save_merchant_alias(merchant_key, display_name)`, `delete_merchant_alias(id)`.
- **Relatório**: em `generate_financial_report`, trocar o agrupamento de `row.description` por `COALESCE(alias.display_name, merchant_key)` (JOIN com `merchant_aliases`).

### 1.4 Frontend

- "Principais estabelecimentos" (Relatórios) ganha um lápis por linha → modal simples "Renomear estabelecimento" (salva alias).
- Nova subaba "Estabelecimentos" em **Categorias e regras** listando os top merchants com contagem/soma e o alias editável — reaproveita o layout `rule-list`.

### 1.5 Critérios de aceite

- [ ] "SUPERMERCADO BH LTDA" e "COMPRA CARTAO SUPERMERCADO BH 02/06" aparecem como um único estabelecimento no relatório.
- [ ] Renomear um estabelecimento reflete no relatório sem recarregar o app.
- [ ] App abre normalmente com banco grande (backfill não bloqueia > 1s; medir com ~10k transações sintéticas).
- [ ] `cargo test` cobre ≥ 8 casos de normalização com descrições reais.

---

## Etapa 2 — Sugestão de categoria por histórico

**Problema hoje:** na importação, só as regras explícitas sugerem categoria (`first_match` em [preview_import](../src-tauri/src/commands/mod.rs)). Se o usuário já categorizou "FARMACIA DROGASIL" 12 vezes como Saúde mas nunca criou regra, a 13ª chega sem sugestão.

### 2.1 Algoritmo — `domain/suggestion.rs`

Sem tabela nova: o histórico É o modelo. Para cada candidato sem match de regra:

```sql
SELECT category_id, COUNT(*) n, MAX(date) last_used
FROM transactions
WHERE merchant_key = ?1 AND category_id IS NOT NULL
  AND deleted_at IS NULL AND category_source IN ('manual','rule')
GROUP BY category_id ORDER BY n DESC, last_used DESC LIMIT 2
```

Aceitar a sugestão só quando há **confiança real** (é aqui que mora o risco de falso positivo):
- `n ≥ 2` ocorrências da categoria vencedora; **e**
- a vencedora tem ≥ 70% das ocorrências categorizadas daquele merchant (se o usuário oscila entre duas categorias, não sugerir); **e**
- sinal do valor compatível com o `kind` da categoria (não sugerir categoria de despesa para crédito).

Fallback quando o merchant é inédito: nenhuma sugestão. Não inventar por similaridade de texto parcial na v1 — é o que gera sugestão lixo e destrói a confiança do usuário.

### 2.2 Backend

- `ImportCandidate` ganha `suggestion_source: Option<"rule" | "history">` (hoje o campo `suggested_rule_*` já distingue implicitamente; adicionar o enum explícito e manter os campos atuais).
- Integrar nos 3 previews de importação (banco conhecido, CSV mapeado, cartão) **após** o loop de regras: regra explícita sempre vence histórico.
- Uma única query em lote por preview (`WHERE merchant_key IN (...)`), não uma por linha — previews têm centenas de linhas.

### 2.3 Frontend

- No preview de importação, sugestão por histórico aparece com selo "pelo seu histórico" (diferente do atual "regra: X"), reusando `source-label`.
- Ao aceitar em massa: botão "Aplicar sugestões" já existente cobre; nada novo.
- Tela de revisão pós-mudança de categoria (o modal "Usar esta correção no futuro?" em Transactions) ganha terceira opção: "Não perguntar de novo para este estabelecimento" → cria alias de categoria implícito (na prática só fecha o modal — o histórico passa a cobrir).

### 2.4 Critérios de aceite

- [ ] Importar extrato com merchant categorizado ≥ 2× no passado sugere a categoria correta com o selo "pelo seu histórico".
- [ ] Merchant com histórico dividido (50/50 entre duas categorias) **não** recebe sugestão.
- [ ] Regra explícita sempre prevalece sobre histórico.
- [ ] Teste de performance: preview de 500 linhas categoriza em < 200ms (query em lote).

---

## Etapa 3 — Detecção de assinaturas

### 3.1 Algoritmo — `domain/subscriptions.rs`

Rodar sob demanda (não persistir na v1 — é barato). Sobre os últimos 12 meses:

1. Agrupar despesas por `merchant_key` (excluir transferências/investimentos e faturas de cartão pagas — usar as compras do cartão, não o pagamento da fatura, para não contar duas vezes).
2. Grupo vira candidato a assinatura quando:
   - ≥ 3 ocorrências;
   - intervalo mediano entre ocorrências ∈ [26, 35] dias (mensal) — v1 só mensal; anual fica para depois;
   - coeficiente de variação do valor ≤ 15% (assinaturas com reajuste ainda passam; mercado semanal não).
3. Saída por assinatura: merchant (com alias), valor mais recente, valor médio, dia típico de cobrança, primeira/última ocorrência, total gasto em 12 meses, status `ativa` (última ocorrência ≤ 40 dias) ou `possivelmente cancelada`.

### 3.2 Backend

- Comando `detect_subscriptions() -> Vec<Subscription>` em novo `commands/insights.rs`.
- Tabela `subscription_dismissals(merchant_key PRIMARY KEY)` na migração 0012: quando o usuário marcar "isso não é assinatura", nunca mais listar (falso positivo clássico: aluguel, mensalidade escolar — que *são* recorrentes mas o usuário pode não querer ver como "assinatura").

### 3.3 Frontend

- Novo painel em **Relatórios**: "Assinaturas detectadas — R$ X/mês em Y serviços", lista com valor, dia de cobrança e ação "não é assinatura" (dismiss).
- Card no Dashboard só com o total ("Suas assinaturas somam R$ X/mês"), clicável → Relatórios.
- Cruzamento com Recorrências: se a assinatura detectada não tem recorrência cadastrada, oferecer "criar recorrência a partir desta" (pré-preenche o formulário da tela Recorrências via query string, ex.: `/recurring?prefill=...`).

### 3.4 Critérios de aceite

- [ ] Fixture de teste com Netflix mensal (valor com 1 reajuste), mercado semanal e aluguel: detecta Netflix e aluguel, ignora mercado.
- [ ] Dismiss persiste e some de todas as telas.
- [ ] Assinatura sem cobrança há 60 dias aparece como "possivelmente cancelada".

---

## Etapa 4 — Detecção de anomalias

### 4.1 Algoritmo — em `commands/insights.rs`

Comparar o mês corrente com a **mediana** dos 6 meses anteriores (mediana, não média — um mês atípico no histórico não pode contaminar a régua), por categoria de despesa:

- Só considerar categorias com ≥ 3 meses de histórico não-zero (senão "não há régua").
- Anomalia de alta: gasto do mês ≥ 140% da mediana **e** diferença absoluta ≥ R$ 50 (o piso absoluto elimina "gastou 300% a mais em Tarifas: R$ 3,00").
- Anomalia de queda (informativa, tom positivo): ≤ 50% da mediana com piso de R$ 50.
- Para o mês em andamento, comparar proporcionalmente: mediana × (dia atual ÷ dias do mês), reaproveitando `effective_days`/`days_in_month` já existentes em [reports.rs](../src-tauri/src/commands/reports.rs).

Saída: `Vec<Anomaly { categoryId, categoryName, currentInCents, baselineInCents, changePercent, direction }>`, ordenada por diferença absoluta, máximo 5.

### 4.2 Integração

- Comando `detect_anomalies(month)` — também consumido pela Etapa 5.
- As anomalias entram no painel "Pontos de atenção" que já existe em Relatórios (array `alerts`), mas como objetos estruturados com link para a tendência da categoria (o drill-down da Fase 2 já existe — reusar `CategoryTrendPanel`).

### 4.3 Critérios de aceite

- [ ] Fixture: transporte na mediana R$ 200, mês atual R$ 290 → anomalia "+45%"; tarifas R$ 2 → R$ 6 não aparece.
- [ ] Dia 10 do mês com gasto proporcional normal **não** dispara anomalia (teste do ajuste pro-rata).
- [ ] Clicar na anomalia abre a tendência de 12 meses daquela categoria.

---

## Etapa 5 — Resumo mensal "Seu mês em números"

### 5.1 Backend — `monthly_recap(month)` em `commands/insights.rs`

Agrega dados que os comandos existentes já sabem calcular + etapas 3/4:

| Bloco | Fonte |
|-------|-------|
| Total gasto, poupado, taxa de poupança, comparativo com mês anterior | `generate_financial_report` (reusar internals, extrair funções privadas se preciso) |
| Maior gasto único do mês | query direta |
| Categoria que mais cresceu / mais caiu | `detect_anomalies` |
| Dias sem gastar | query `COUNT(DISTINCT date)` vs dias do mês |
| Assinaturas ativas e total/mês | `detect_subscriptions` |
| Metas: batidas/estouradas | `goals` do relatório |

Retorna struct única `MonthlyRecap` — sem persistência; é uma view calculada.

### 5.2 Frontend

- **Card no Dashboard**: quando o mês selecionado é um mês *fechado* (anterior ao atual), mostrar "📊 Seu mês em números" com 3 destaques + botão "ver completo".
- **Modal completo** (`MonthlyRecapModal`): blocos em cards com os números acima, cada um em uma frase narrada em pt-BR ("Você passou **9 dias sem gastar nada** — seu recorde nos últimos 6 meses"). Frases geradas por template no frontend, não no Rust (facilita ajustar tom sem recompilar).
- Primeira abertura do app em um mês novo: toast discreto "Seu resumo de {mês} está pronto" (guardar `last-recap-seen` em `localStorage`; zero backend).

### 5.3 Critérios de aceite

- [ ] Dashboard de mês fechado mostra o card; mês corrente não mostra.
- [ ] Todos os números do recap batem com os do relatório do mesmo período (teste de consistência no backend comparando as duas saídas).
- [ ] Nenhuma frase renderiza com valor ausente ("undefined", "NaN") — cada bloco tem estado vazio próprio.

---

## Decisões de arquitetura registradas

1. **Sem cache/persistência de insights na v1.** Tudo recalculado sob demanda — com SQLite local e milhares (não milhões) de linhas, as queries ficam < 100ms. Se um dia pesar, adicionar cache é trivial; remover cache errado não é.
2. **`merchant_key` como coluna derivada** e recalculável, nunca editada pelo usuário. O que o usuário edita é o *alias* (tabela separada). Isso permite evoluir o algoritmo de normalização sem migração de dados — basta rodar o backfill de novo (comando ganha flag `force`).
3. **Heurísticas com limiares em constantes nomeadas** no topo de cada módulo (`MIN_OCCURRENCES`, `MAX_AMOUNT_VARIANCE`, …) com comentário do porquê — são os números que mais vão ser ajustados com feedback real.
4. **Regra explícita > histórico > nada.** A hierarquia de sugestão nunca inverte; o usuário sempre pode ver por que algo foi sugerido.

## Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Normalização agressiva demais funde merchants distintos ("POSTO BR CENTRO" + "POSTO BR ZONA SUL") | Normalização remove só ruído comprovado (números, datas, prefixos de pagamento); nunca remove palavras "de conteúdo". Alias permite separar manualmente. |
| Sugestões de categoria erradas minam a confiança | Limiares conservadores (≥2 ocorrências, ≥70% dominância); selo visual distinto; nunca aplicar automaticamente, só sugerir. |
| Falso positivo de assinatura irrita | Dismiss permanente por merchant, um clique. |
| Duplo trabalho entre `alerts` (strings) e anomalias (estruturadas) | Migrar os alerts existentes para o formato estruturado nesta fase; strings viram fallback. |
| Backfill lento em bancos grandes na primeira abertura | Lotes de 500 + índice parcial; medir com fixture de 10k linhas antes de mergear. |

## Definição de pronto da fase

- Todas as caixas de critérios de aceite marcadas.
- `cargo test` (estimativa: +15 a 20 testes novos), `npm test`, `tsc -b` e `vite build` verdes.
- Verificação visual das 4 superfícies novas (estabelecimentos, preview de importação com selo, painel de assinaturas, recap) nos dois temas.
- [PLANO_MELHORIAS.md](PLANO_MELHORIAS.md) atualizado com os itens da Fase 3 marcados.

---

*Criado em 2026-07-03. Revisar limiares das heurísticas após uso real com dados próprios.*
