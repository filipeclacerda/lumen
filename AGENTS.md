# AGENTS.md — contexto para contribuidores e agentes

## Produto e princípios

**Lumen** é um gestor financeiro pessoal desktop, local-first e em português. Não há backend web nem conta obrigatória: dados financeiros ficam em SQLite local (`financa.db` no `app_data_dir` do Tauri). Privacidade e integridade são requisitos de produto, não detalhes de implementação.

- Frontend: React 19 + TypeScript + Vite + TanStack Query/Zustand.
- Desktop/backend: Tauri 2 + Rust + SQLx/SQLite.
- A interface nunca acessa SQLite diretamente; toda operação de domínio/persistência cruza um comando Tauri.
- Valores monetários persistidos são **inteiros em centavos** (`i64`); datas usam ISO `YYYY-MM-DD`. Consulte `docs/adr/0002-money-and-deduplication.md`.
- O banco e os backups ainda **não são criptografados**. As proteções atuais garantem integridade, validação e recuperação, mas não confidencialidade em repouso. Não apresente o produto como criptografado e não implemente telemetria, sync externo ou envio de extratos sem uma decisão explícita de produto/segurança.

Leia `README.md` para as funcionalidades e `docs/adr/` antes de alterar decisões arquiteturais.

## Mapa rápido do repositório

```text
src/
  app/App.tsx                    # shell e rotas
  features/<domínio>/            # páginas/componentes por funcionalidade
  shared/api.ts                  # única fachada frontend -> invoke Tauri; também tem dados demo web
  shared/types.ts                # contratos TypeScript
  shared/ui/                     # componentes reutilizáveis
  shared/format.ts, period.ts    # utilitários
src-tauri/
  src/lib.rs                     # bootstrap Tauri e registro de TODOS os comandos
  src/commands/                  # casos de uso/comandos por domínio
  src/domain/                    # regras puras (dinheiro, importação, categorização etc.)
  src/infrastructure/database.rs # pool SQLite, WAL, foreign keys, migrations
  src/infrastructure/importer.rs # parsers OFX/CSV/PDF e detecção
  src/application/state.rs       # pool e sessões temporárias de importação em memória
  migrations/                    # evolução linear do schema
  tauri.conf.json                # CSP, bundle e updater
.github/workflows/
  ci.yml                         # build/test Windows
  release.yml                    # release assinada Windows
```

Principais domínios já implementados: onboarding/perfil, contas, transações e transferências, categorias e regras, importação CSV/OFX/PDF, cartões e faturas, metas/orçamento, recorrências, relatórios, exportação, backup/restauração, estabelecimentos e patrimônio.

## Fluxo de dados e convenções

1. Um componente chama `api` em `src/shared/api.ts`.
2. Em Tauri, `api` usa `invoke("nome_do_comando", { ... })`.
3. O comando Rust fica em `src-tauri/src/commands/` e precisa estar registrado em `src-tauri/src/lib.rs`.
4. O comando valida entrada, usa `AppState.db`/SQLx e retorna structs serializáveis em camelCase.

Ao adicionar um comando, atualize **os três pontos**: implementação Rust, `generate_handler!` em `lib.rs`, e a fachada/contratos TypeScript (`api.ts`/`types.ts`). Mantenha o fallback demo de `api.ts` quando a tela precisar funcionar em navegador sem Tauri.

### Invariantes importantes

- Centavos são a fonte de verdade; não persistir `float`/`f64` para dinheiro. O parser decimal usa aritmética inteira verificada e rejeita expoentes, `NaN`, infinito, frações inválidas, `i64::MIN` e overflow; preserve essas garantias e seus testes.
- Importações devem ser confirmadas somente depois de prévia e são persistidas atomicamente. Deduplicação usa `external_id` normalizado; ausente isso, usa fingerprint SHA-256 de conta, data, valor e descrição normalizada. A prévia e o commit precisam tratar duplicatas existentes, intra-arquivo e corridas entre prévia/edição/confirmação.
- Transferências são duas pernas vinculadas e não podem entrar como receita/despesa. Não quebre as proteções de edição ou os links de transferência.
- Exclusões são majoritariamente soft delete (`deleted_at`); consultas e índices precisam respeitá-lo.
- Categorias, regras e dados seed são parte do comportamento do produto. Respeite `kind`, prioridades e categorias de sistema.
- Sessões de importação ficam só em memória (`AppState`): são efêmeras e devem retornar `SessionExpired` quando ausentes.
- Erros expostos ao frontend usam `AppError`; não exponha paths locais, SQL ou dados financeiros em mensagens novas.

### Banco e migrations

- Crie uma nova migration sequencial em `src-tauri/migrations/`; **nunca edite migration já distribuída**. SQLx valida checksums. `database.rs` contém apenas uma compatibilidade específica para diferenças CRLF/LF de checksum.
- `connect()` habilita WAL e foreign keys e roda migrations. Teste uma migration com banco vazio e, se aplicável, banco com dados anteriores.
- Backup usa `VACUUM INTO` para produzir um snapshot consistente e independente do WAL. Restore trabalha sobre uma cópia de staging, valida integridade, foreign keys, histórico de migrations e schema, e mantém rollback até o banco restaurado abrir com sucesso.
- No Windows, a publicação de backup e a ativação do restore usam operações nativas de substituição/movimentação com write-through. Preserve a máquina de recovery para estados intermediários (`live`, `pending` e `rollback`) e nunca remova o banco anterior antes da validação completa.
- Backup, staging e rollback continuam em SQLite sem criptografia. Uma futura adoção de SQLCipher deve cobrir também snapshots, restore, rotação/recuperação de chave e compatibilidade com backups antigos.

## Comandos de trabalho

Pré-requisitos: Node 22+, Rust e dependências nativas do Tauri (no Windows, MSVC/Build Tools e WebView2).

```bash
npm ci
npm run tauri dev
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

O build desktop é `npm run tauri -- build`.

### Estado atual da qualidade

- Na revisão de integridade mais recente, `npm test` passou com 12 testes e `cargo test` passou com 95 testes.
- `npm run check` passa e executa lint, Prettier, testes frontend e build. O CI também executa lint, format check, testes/build frontend, `cargo fmt`, clippy, testes Rust e build Tauri debug.
- `npm run build` passa, mas gera um bundle inicial grande (~934 KB minificado); prefira carregamento sob demanda para telas pesadas, especialmente relatórios/gráficos/importação.
- Backup/restore possui testes automatizados de WAL, migrations, schema, rollback e estados interrompidos no Windows, mas releases ainda devem incluir um teste manual no aplicativo Tauri empacotado.
- `node_modules/`, `dist/`, `src-tauri/target/` e `*.tsbuildinfo` são artefatos; não os adicione ao Git nem deixe alterações geradas no diff.

## Design system e interface

O Lumen usa uma linguagem visual sóbria, clara e acolhedora, adequada a um produto financeiro privado: superfícies neutras, verde como cor de marca, hierarquia tipográfica direta e densidade moderada. A interface deve transmitir segurança sem parecer bancária ou excessivamente técnica. Preserve a consistência entre temas claro e escuro e prefira composição simples, disclosure progressivo e poucos controles por contexto.

### Fontes de verdade

- `src/styles/tokens.css`: cores semânticas, tipografia, espaçamento, raios, sombras e movimento. Use sempre variáveis `--*`; não introduza cores, sombras, raios ou durações literais quando já existir um token adequado.
- `src/styles/base.css`, `primitives.css` e `layout.css`: comportamento global, componentes CSS e responsividade. `features.css` deve conter apenas exceções realmente específicas de uma funcionalidade.
- `src/shared/ui/`: primitives React reutilizáveis. Antes de criar markup local, verifique `PageHeader`, `Modal`/`OverlayDialog`, `Tabs`, `Select`, `MoneyInput`, `MonthNavigator`, `Pagination`, `AsyncState`, gráficos e toast.
- Dashboard, Transações, Relatórios e Configurações são referências de composição. Não copie classes específicas de uma feature para outra; extraia um padrão compartilhado quando ele se repetir.

### Tokens e linguagem visual

- Superfícies seguem `--surface-bg` → `--surface` → `--surface-2`/`--surface-3`; bordas usam `--border`, `--border-soft` ou `--border-strong`. Elevação deve ser rara e usar `--shadow-xs` a `--shadow-lg` conforme a camada.
- Texto principal usa `--text`; apoio e metadados usam `--text-muted` ou `--text-soft`. Não enfraqueça contraste de informação essencial, especialmente valores, labels e erros.
- Verde (`--brand`, `--brand-strong`, `--brand-soft`) identifica marca, seleção e ação principal. Estados usam exclusivamente os conjuntos `--status-success-*`, `--status-warning-*`, `--status-danger-*` e `--status-info-*`; não use apenas cor para comunicar significado.
- Gráficos usam `--data-1` a `--data-8`. Receitas, despesas, investimentos e alertas devem manter a semântica já aplicada pelos helpers `status-*` e `tx-icon-*`.
- Espaçamento parte da escala de 4 px (`--space-1` a `--space-8`), raios de `--radius-sm` a `--radius-xl` e tipografia de `--text-xs` a `--text-xl`. Valores monetários devem usar numerais tabulares e formatação de `shared/format.ts`.
- Animações são curtas, funcionais e usam os tokens `--motion-*`; respeite `prefers-reduced-motion`. Evite movimento ornamental em dados financeiros ou operações destrutivas.

### Composição de telas

- Toda página começa com `PageHeader`: eyebrow opcional para contexto/período, título curto, descrição em `.muted` e no máximo uma ação primária visível. Ações secundárias ficam agrupadas e devem quebrar corretamente em telas estreitas.
- Use `.panel`/`article` para blocos independentes, `.cards` para métricas comparáveis e `.panel-title` para título mais contexto ou ação. Evite aninhar cartões sem necessidade e não use sombra para substituir hierarquia de conteúdo.
- Organize a informação na ordem: contexto, resumo, ação/alerta relevante e detalhes. Prefira revelar filtros e opções avançadas sob demanda em vez de manter barras densas permanentemente abertas.
- Estados assíncronos são obrigatórios: `LoadingState`, `EmptyState` e `ErrorState` devem ocupar a mesma região do conteúdo que substituem; erros recuperáveis oferecem nova tentativa e mutações confirmadas usam toast.
- Use `Tabs` para poucas visões irmãs, `MonthNavigator` para períodos mensais, `Pagination` para coleções extensas e `Select`/`CategorySelect` no lugar de implementações locais. Modais são reservados a tarefas focadas ou confirmação; fluxos longos pertencem à página.
- Ações destrutivas usam `--danger`, linguagem explícita e confirmação proporcional ao risco. Nunca torne a ação destrutiva a ação visual primária por conveniência de layout.

### Controles, responsividade e acessibilidade

- A escala de controles é: ação principal com 44 px de altura, secundária com 40 px e compacta/textual/ícone com 36 px. Ícones vêm de `lucide-react`, normalmente entre 16 e 20 px, sempre acompanhados de label visível ou `aria-label` inequívoco.
- Campos têm label persistente, texto de ajuda ou erro próximo e foco com `--focus`/`--ring`. Não use placeholder como único rótulo. Dinheiro deve usar `MoneyInput`; não manipule valores monetários como ponto flutuante no componente.
- Preserve HTML semântico, ordem de foco e navegação por teclado. Tabs, dialogs e selects compartilhados já implementam comportamento acessível; estenda essas primitives em vez de recriá-las. Alvos interativos principais devem ter pelo menos 44 px.
- Abaixo de 850 px, a navegação vira drawer; abaixo de 650 px, headers, ações e grids empilham. Novas telas devem funcionar sem overflow horizontal; tabelas extensas ficam em `.table-scroll` e precisam manter contexto legível.
- Teste temas claro e escuro, zoom, foco visível, conteúdo vazio, mensagens longas e valores monetários grandes. Não dependa de hover para revelar ação essencial e não comunique estados somente por cor ou ícone.

### Checklist para mudanças de UI

- [ ] Reutiliza tokens e componentes compartilhados antes de criar variantes locais.
- [ ] Mantém hierarquia, espaçamento e escala de controles coerentes com telas existentes.
- [ ] Cobre loading, vazio, erro, sucesso e estado desabilitado quando aplicável.
- [ ] Funciona nos temas claro/escuro e nos breakpoints de 850 px e 650 px.
- [ ] É operável por teclado, tem foco visível e labels acessíveis.
- [ ] Foi validada no modo Tauri e no fallback web quando a tela o suporta.

## Como alterar com segurança

- Faça mudanças pequenas e focadas; não refatore áreas financeiras sem testes de regressão.
- Para bug de importação, adicione uma fixture anonimizida e um teste ao parser/commit correspondente. Nunca commite extratos reais, CPFs, números de conta ou dados pessoais.
- Para mudanças de UI, valide tanto o modo Tauri quanto o fallback demo quando aplicável.
- Para operações destrutivas (restore, reset, exclusão em massa), exija confirmação na UI e mantenha comportamento recuperável.
- Ao tocar em relatórios, orçamento, cartões ou transferências, cubra sinais (positivo/negativo), estornos, itens deletados, datas de fronteira e meses com tamanhos diferentes.
- Use commits convencionais (`feat:`, `fix:`, `test:`, `docs:`, etc.), conforme `CONTRIBUTING.md`.

## Prioridades técnicas conhecidas

1. **Criptografia local em repouso**: definir ADR e threat model; avaliar SQLCipher; proteger a chave pelo SO (DPAPI/Windows Credential Manager, Keychain e Secret Service quando houver suporte); planejar migração transacional do SQLite atual, rotação, recuperação e perda de chave.
2. **Backup/restore criptografado e compatível**: decidir se backups usarão a mesma chave ou uma senha/chave própria; impedir cópias plaintext residuais; suportar importação controlada de backups legados não criptografados; validar recovery e rollback sem expor a chave.
3. **Testes desktop/e2e**: cobrir onboarding, importação bancária e de cartão, transferências, faturas, reset e backup/restore em uma build Tauri real, incluindo falha de relaunch, arquivo bloqueado, banco corrompido e upgrade entre versões.
4. **Code splitting e performance**: lazy loading por rota para reduzir o bundle inicial (~934 KB), começando por relatórios, gráficos e importação; medir startup e regressões antes/depois.
5. **Reconciliação e qualidade dos dados**: saldo informado por data, diferença para saldo calculado, ajuste auditável e central de pendências para duplicatas, não categorizadas e vínculos incompletos.
6. **Política de backup local**: lembrete pela idade do último backup, snapshots rotativos opcionais e teste periódico de restauração, sempre sem nuvem ou telemetria implícita.
7. **Acessibilidade e cobertura frontend**: ampliar testes de teclado/foco, estados de erro e gráficos interativos; consolidar modais sobre uma primitive com focus trap.

## Checklist antes de finalizar

- [ ] Tipos frontend, chamada `api.ts`, comando registrado e serialização Rust estão coerentes.
- [ ] Migrations novas são aditivas/compatíveis e não modificam arquivos históricos.
- [ ] Valores continuam em centavos inteiros e sinais financeiros foram testados.
- [ ] Não há dados financeiros reais, segredos, chaves de criptografia ou artefatos de build no diff.
- [ ] Mudanças de criptografia documentam migração, armazenamento/rotação/recuperação da chave, backup legado e comportamento em falhas, sem deixar cópia plaintext residual.
- [ ] `npm run check` e `cargo test --manifest-path src-tauri/Cargo.toml` foram executados.
- [ ] Para mudanças Rust: `cargo fmt --check` e clippy foram executados.
