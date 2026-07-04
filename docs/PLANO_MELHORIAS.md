# Plano de Melhorias — Lúmen

> Objetivo: evoluir o Lúmen para oferecer a melhor experiência possível ao usuário, mantendo os pilares do projeto — **local-first, privacidade e leveza**.
>
> Estado atual coberto: dashboard mensal, relatórios com metas e comparação de períodos, transações, importação de extratos e faturas de cartão (com preview, mapeamento de CSV e conciliação de pagamento de fatura), categorias com regras automáticas, contas, backup/restauração e exportação CSV.

---

## 1. Usabilidade (UX)

### 1.1 Navegação e produtividade
- [ ] **Busca global (Ctrl+K)** — paleta de comandos para buscar transações, pular para telas e executar ações rápidas ("nova transação", "importar extrato").
- [ ] **Atalhos de teclado** — `N` nova transação, `/` busca, `←/→` navegar entre meses, `Del` excluir selecionadas. Tela de ajuda com `?`.
- [x] **Navegação de mês unificada** — seletor `MonthNavigator` com setas ‹ ›, atalho "hoje" e helpers de período compartilhados (`shared/period.ts`) usados por Dashboard e Relatórios. *(Fase 1 — entregue)*
- [ ] **Estado persistente por tela** — lembrar filtros, mês selecionado e ordenação ao trocar de tela e ao reabrir o app.

### 1.2 Transações
- [ ] **Edição inline** — editar categoria, descrição e valor direto na lista, sem abrir modal.
- [ ] **Seleção múltipla melhorada** — shift+click para intervalo, barra de ações flutuante (categorizar, excluir, mover de conta).
- [ ] **Divisão de transação (split)** — dividir uma compra em várias categorias (ex.: mercado = alimentação + limpeza).
- [ ] **Anexos e notas** — permitir nota livre e anexo de comprovante (imagem/PDF) por transação, armazenado localmente.
- [x] **Transações recorrentes** — nova tela "Recorrências": cadastro de despesas/receitas fixas com dia do mês, início/fim opcional; geração automática dos lançamentos pendentes ao abrir o app (idempotente, com backfill de meses perdidos) e botão manual "Gerar pendentes agora". *(Fase 2 — entregue)*
- [x] **Transferências entre contas** — comando `create_transfer` cria as duas pernas atomicamente na categoria "Transferências" (fora de receitas/despesas); opção "Transferência" no formulário de nova transação. *(Fase 1 — entregue)*
- [x] **Desfazer (undo)** — "Desfazer" após exclusão e agora também após categorização em massa (restaura as categorias anteriores). *(Fase 1 — entregue)*

### 1.3 Importação
- [ ] **Arrastar e soltar** arquivo em qualquer tela para iniciar importação.
- [ ] **Detecção de duplicatas mais visível** — no preview, destacar prováveis duplicatas com explicação ("mesmo valor e data de transação já existente") e ação em massa "ignorar todas".
- [ ] **Sugestão de categoria com base no histórico** — além das regras, sugerir categoria por similaridade com transações já categorizadas (aprendizado local, sem nuvem).
- [ ] **Resumo pós-importação** — tela de conclusão: N importadas, N ignoradas, N sem categoria, com link direto para revisar as sem categoria.

### 1.4 Acessibilidade e polish
- [x] **Modo escuro** (e detecção do tema do sistema) — já existia via `shared/theme.ts` e toggle na barra lateral.
- [ ] **Estados vazios acolhedores** — cada tela sem dados deve orientar o próximo passo (ex.: "Nenhuma transação — importe um extrato ou adicione manualmente").
- [ ] **Esqueleto de carregamento** em vez de "Carregando…" textual.
- [ ] **Acessibilidade** — foco visível, navegação por teclado nos modais, `aria-labels`, contraste AA.
- [ ] **Onboarding com dados de exemplo** — opção "explorar com dados fictícios" para o usuário conhecer o app antes de importar dados reais.

---

## 2. Novas funcionalidades

### 2.1 Orçamento (alto impacto)
- [~] **Orçamento mensal por categoria** — parcialmente coberto pelas "Metas" já existentes em Relatórios (valor planejado × realizado por categoria, barra de progresso, alerta quando a projeção estoura a meta). Falta: alerta específico em 80%/100% (hoje só alerta na projeção) e uma tela dedicada de orçamento fora de Relatórios.
- [ ] **Rollover opcional** — sobra/estouro do mês anterior transportado para o seguinte.
- [ ] **Orçamento anual** — visão do ano com planejado × realizado mês a mês.

### 2.2 Planejamento
- [ ] **Objetivos de poupança** — "juntar R$ X até tal data" com progresso, aporte sugerido por mês e vínculo com conta/categoria de investimento.
- [ ] **Calendário financeiro** — visão mensal em calendário com vencimentos de fatura, recorrências e dias de maior gasto.
- [ ] **Projeção de fim de mês** — com base no ritmo de gasto atual, estimar o saldo no fim do mês ("nesse ritmo você fecha o mês com R$ X").

### 2.3 Cartão de crédito (aprofundar o que já existe)
- [ ] **Painel do cartão** — limite cadastrado × utilizado, fatura aberta/fechada, melhor dia de compra.
- [ ] **Parcelamentos** — reconhecer compras parceladas (ex.: "3/10") e projetar comprometimento das próximas faturas.
- [ ] **Alerta de vencimento de fatura** — notificação nativa do sistema alguns dias antes.

### 2.4 Patrimônio
- [ ] **Evolução do patrimônio líquido** — soma dos saldos das contas ao longo do tempo (a peça que falta para fechar o ciclo: fluxo mensal já existe, estoque ainda não).
- [ ] **Saldo por conta com reconciliação** — informar o saldo real do banco e o app apontar divergências.

### 2.5 Dados e portabilidade
- [ ] **Exportação ampliada** — além do CSV atual: JSON completo, OFX e exportação de relatório em PDF.
- [ ] **Backup automático agendado** — backup local periódico com rotação (manter últimos N), em pasta escolhida pelo usuário (inclusive pasta sincronizada por Dropbox/Drive, mantendo o local-first).
- [ ] **Criptografia opcional do banco** — senha mestra usando SQLCipher ou equivalente.

---

## 3. Gráficos e visualizações

- [x] **Adotar uma lib de gráficos** — Recharts adicionado; cores via variáveis CSS do tema (funciona no claro e no escuro). *(Fase 1 — entregue)*
- [x] **Fluxo de caixa mensal** — painel no Dashboard com barras de receita × despesa dos últimos 6 meses e linha de saldo, alimentado por `generate_financial_report`. *(Fase 1 — entregue)*
- [x] **Donut de gastos por categoria** — donut interativo em Relatórios; clicar numa fatia ou barra abre a tendência da categoria e um link "Ver transações" que já aplica o filtro em Transações. *(Fase 2 — entregue)*
- [x] **Tendência por categoria** — comando `category_trend` (12 meses) plugado ao drill-down do donut, com gráfico de área. *(Fase 2 — entregue)*
- [ ] **Heatmap de gastos** — calendário com intensidade de gasto por dia.
- [ ] **Sankey de fluxo do dinheiro** — renda → categorias de gasto → poupança (visão anual).
- [ ] **Gráfico de evolução do patrimônio** — área acumulada por conta (depende de 2.4).
- [ ] **Comparativo entre períodos visual** — barras lado a lado deste mês × mês anterior × média de 6 meses, por categoria.

---

## 4. Métricas e insights

### 4.1 Indicadores no Dashboard
- [x] **Taxa de poupança** — card dedicado no Dashboard (já existia em Relatórios; agora também no retrato do mês). *(Fase 2 — entregue)*
- [x] **Gasto médio diário** e projeção do mês — cards "Ritmo diário de gastos" e "Projeção do mês" no Dashboard, usando `latestMonthSummary` do relatório financeiro. *(Fase 2 — entregue)*
- [ ] **Custo fixo × variável** — marcar categorias como fixas e mostrar o índice de comprometimento da renda.
- [ ] **Top 5 estabelecimentos do mês** — onde o dinheiro mais foi (agrupado por descrição normalizada).

### 4.2 Insights automáticos (locais, sem IA em nuvem)
- [ ] **Detecção de anomalias** — "seu gasto com transporte está 45% acima da sua média".
- [ ] **Detecção de assinaturas** — identificar cobranças recorrentes de mesmo valor/descrição e listar "suas assinaturas somam R$ X/mês".
- [ ] **Resumo mensal narrado** — no fechamento do mês, um card "Seu mês em números": maior gasto, categoria que mais cresceu, dias sem gastar, comparação com metas.
- [ ] **Saúde financeira** — score simples e transparente (poupança, comprometimento com fixos, uso do cartão) com explicação de como melhorar cada componente.

---

## 5. Qualidade de dados

- [ ] **Normalização de descrições** — limpar descrições de extrato ("PAG*JoseSilva" → "José Silva"), com dicionário editável de apelidos por estabelecimento.
- [ ] **Merchant/estabelecimento como entidade** — agrupar transações por estabelecimento para métricas (4.1) e regras mais precisas.
- [ ] **Tags livres** além de categorias (ex.: `#viagem-janeiro`, `#reembolsável`) com filtro e soma por tag.
- [ ] **Auditoria de categorização** — tela "X transações sem categoria" com fluxo rápido de revisão (uma por vez, atalhos de teclado).
- [ ] **Validação de integridade** — verificação periódica: transações órfãs, faturas sem conta, somas inconsistentes; com correção assistida.

---

## 6. Priorização sugerida

| Fase | Itens | Critério |
|------|-------|----------|
| **Fase 1 — Fundamentos** ✅ | Lib de gráficos + fluxo de caixa no Dashboard (3), seletor de período unificado (1.1), transferências entre contas (1.2), modo escuro (1.4), undo (1.2) | **Concluída em 2026-07-03** |
| **Fase 2 — Orçamento** ✅ | Taxa de poupança e gasto diário no Dashboard (4.1), donut interativo e tendência por categoria (3), recorrentes (1.2) | **Concluída em 2026-07-03.** Orçamento por categoria (2.1) ficou parcial — as Metas existentes cobrem o essencial; rollover e visão anual ficaram para depois |
| **Fase 3 — Inteligência local** | Detecção de assinaturas e anomalias (4.2), sugestão de categoria por histórico (1.3), normalização de descrições (5), resumo mensal (4.2) | Diferencial competitivo mantendo privacidade. **Plano detalhado: [PLANO_FASE3.md](PLANO_FASE3.md)** |
| **Fase 4 — Patrimônio e robustez** | Evolução patrimonial (2.4), parcelamentos (2.3), backup automático (2.5), criptografia (2.5), split de transações (1.2) | Completa a visão financeira e blinda os dados |
| **Contínuo** | Acessibilidade, estados vazios, atalhos, busca global, exportações | Polish distribuído em todas as fases |

### Métricas de sucesso do plano
- Tempo entre abrir o app e "entender o mês" < 10 segundos (Dashboard responde tudo).
- Zero transações sem categoria após uma importação típica (regras + sugestões + fluxo de revisão).
- Usuário consegue responder: "posso gastar quanto ainda esse mês?" (orçamento), "estou melhorando?" (tendências), "quanto eu tenho?" (patrimônio).

---

*Documento vivo — revisar a cada release. Última atualização: 2026-07-03.*
