# Design system do Lumen

O Lumen usa uma interface sóbria e acolhedora para um produto financeiro
local-first. A prioridade é comunicar segurança e clareza com superfícies
neutras, verde como cor de marca, hierarquia direta e densidade moderada.

## Fontes de verdade

- `src/styles/tokens.css` define cores semânticas, tipografia, espaçamento,
  raios, sombras e movimento para temas claro e escuro.
- `src/styles/base.css`, `primitives.css` e `layout.css` mantêm os padrões
  globais; CSS específico permanece em `features.css`.
- `src/shared/ui/` reúne as primitives reutilizáveis: `PageHeader`,
  `OverlayDialog`, `Tabs`, `Select`, `MoneyInput`, `MonthNavigator`,
  `Pagination`, estados assíncronos, gráficos e toast.

## Regras de composição

1. Comece páginas com `PageHeader`, título curto e no máximo uma ação primária
   visível.
2. Use `panel` para blocos independentes e evite cartões aninhados.
3. Apresente contexto, resumo, ação relevante e detalhes nessa ordem.
4. Revele filtros e opções avançadas sob demanda.
5. Para coleções extensas, use `Pagination`; para tabelas, use `.table-scroll`
   quando houver risco de overflow horizontal.

## Tokens e controles

- Use sempre variáveis `--*`; não introduza cor, sombra, raio ou duração literal
  quando houver token semântico equivalente.
- Ação principal: 44 px; ação secundária: 40 px; ação compacta ou ícone: 36 px.
- Verde identifica marca, seleção e ação principal. Estados usam os tokens
  `--status-success-*`, `--status-warning-*`, `--status-danger-*` e
  `--status-info-*` e nunca dependem apenas de cor.
- Valores monetários usam `MoneyInput`, centavos inteiros e formatação de
  `shared/format.ts`.

## Acessibilidade e responsividade

- Todo controle tem label persistente ou `aria-label` inequívoco, foco visível
  e operação por teclado.
- Preferir `Tabs`, `Select` e `OverlayDialog` compartilhados a variantes locais.
- Estados de loading, vazio e erro ocupam a região que substituem e oferecem
  nova tentativa quando possível.
- Abaixo de 850 px a navegação usa drawer; abaixo de 650 px headers, grids e
  ações empilham. O drawer móvel aplica foco preso e bloqueio de scroll somente
  enquanto está aberto.

## Auditoria de julho de 2026

Na versão 0.4.2 foram corrigidos os desvios críticos identificados na revisão
de interface: o drawer desktop deixou de assumir comportamento modal, gráficos
interativos receberam suporte de teclado e estado semântico, e fluxos de
importação, onboarding, configurações, recorrências, categorias e faturas
foram alinhados às primitives e aos requisitos de acessibilidade.

Ainda são melhorias incrementais recomendadas: migrar CSS legado para a
organização atual, substituir hardcodes residuais por tokens e consolidar a
implementação histórica de seleção de categorias. Consulte o checklist em
`AGENTS.md` antes de alterar uma tela.
