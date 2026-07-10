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
