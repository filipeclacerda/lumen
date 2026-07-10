# AGENTS.md — contexto para contribuidores e agentes

## Produto e princípios

**Lumen** é um gestor financeiro pessoal desktop, local-first e em português. Não há backend web nem conta obrigatória: dados financeiros ficam em SQLite local (`financa.db` no `app_data_dir` do Tauri). Privacidade e integridade são requisitos de produto, não detalhes de implementação.

- Frontend: React 19 + TypeScript + Vite + TanStack Query/Zustand.
- Desktop/backend: Tauri 2 + Rust + SQLx/SQLite.
- A interface nunca acessa SQLite diretamente; toda operação de domínio/persistência cruza um comando Tauri.
- Valores monetários persistidos são **inteiros em centavos** (`i64`); datas usam ISO `YYYY-MM-DD`. Consulte `docs/adr/0002-money-and-deduplication.md`.
- O banco ainda **não é criptografado**. Não implemente telemetria, sync externo ou envio de extratos sem uma decisão explícita de produto/segurança.

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

- Centavos são a fonte de verdade; não persistir `float`/`f64` para dinheiro. `parse_brl` e alguns importadores hoje convertem por `f64`; mudanças nessa área devem incluir testes de precisão e entradas inválidas.
- Importações devem ser confirmadas somente depois de prévia e são persistidas atomicamente. Deduplicação usa `external_id`; ausente isso, usa fingerprint SHA-256 de conta, data, valor e descrição normalizada.
- Transferências são duas pernas vinculadas e não podem entrar como receita/despesa. Não quebre as proteções de edição ou os links de transferência.
- Exclusões são majoritariamente soft delete (`deleted_at`); consultas e índices precisam respeitá-lo.
- Categorias, regras e dados seed são parte do comportamento do produto. Respeite `kind`, prioridades e categorias de sistema.
- Sessões de importação ficam só em memória (`AppState`): são efêmeras e devem retornar `SessionExpired` quando ausentes.
- Erros expostos ao frontend usam `AppError`; não exponha paths locais, SQL ou dados financeiros em mensagens novas.

### Banco e migrations

- Crie uma nova migration sequencial em `src-tauri/migrations/`; **nunca edite migration já distribuída**. SQLx valida checksums. `database.rs` contém apenas uma compatibilidade específica para diferenças CRLF/LF de checksum.
- `connect()` habilita WAL e foreign keys e roda migrations. Teste uma migration com banco vazio e, se aplicável, banco com dados anteriores.
- Backup faz checkpoint WAL antes de copiar. Restore atual apenas valida o header SQLite e agenda a troca para a próxima abertura; mudanças nessa área devem preservar o banco atual em caso de arquivo inválido/corrompido.

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

- Na revisão que criou este arquivo, `npm test` passou com 8 testes e `cargo test` passou com 71 testes.
- `npm run build` passa, mas gera um bundle inicial grande (~932 KB minificado); prefira carregamento sob demanda para telas pesadas, especialmente relatórios/gráficos/importação.
- `npm run lint` está **quebrado**: o projeto usa ESLint 9, mas não possui `eslint.config.*`. O CI atual também não roda lint, fmt nem clippy. Não reporte lint como validado até corrigir essa configuração.
- `node_modules/`, `dist/` e `src-tauri/target/` são artefatos ignorados; não os adicione ao Git.

## Como alterar com segurança

- Faça mudanças pequenas e focadas; não refatore áreas financeiras sem testes de regressão.
- Para bug de importação, adicione uma fixture anonimizida e um teste ao parser/commit correspondente. Nunca commite extratos reais, CPFs, números de conta ou dados pessoais.
- Para mudanças de UI, valide tanto o modo Tauri quanto o fallback demo quando aplicável.
- Para operações destrutivas (restore, reset, exclusão em massa), exija confirmação na UI e mantenha comportamento recuperável.
- Ao tocar em relatórios, orçamento, cartões ou transferências, cubra sinais (positivo/negativo), estornos, itens deletados, datas de fronteira e meses com tamanhos diferentes.
- Use commits convencionais (`feat:`, `fix:`, `test:`, `docs:`, etc.), conforme `CONTRIBUTING.md`.

## Prioridades técnicas conhecidas

1. Corrigir ESLint e incluí-lo no CI; adicionar `cargo fmt` e clippy ao pipeline.
2. Parsing decimal de moeda sem `f64`, com validação de limites e casos como `NaN`/infinito.
3. Validar restauração SQLite com `integrity_check`, schema e compatibilidade antes de trocar o banco.
4. Criptografia local (SQLCipher e chave protegida pelo SO), incluindo migração e recuperação.
5. Cobertura frontend/e2e para onboarding, importação, transferências, faturas e backup/restauração.
6. Code splitting para reduzir o carregamento inicial.

## Checklist antes de finalizar

- [ ] Tipos frontend, chamada `api.ts`, comando registrado e serialização Rust estão coerentes.
- [ ] Migrations novas são aditivas/compatíveis e não modificam arquivos históricos.
- [ ] Valores continuam em centavos inteiros e sinais financeiros foram testados.
- [ ] Não há dados financeiros reais, segredos ou artefatos de build no diff.
- [ ] `npm test`, `npm run build` e `cargo test --manifest-path src-tauri/Cargo.toml` foram executados.
- [ ] Para mudanças Rust: `cargo fmt --check` e clippy foram executados.
