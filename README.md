# Finança

Gestor financeiro desktop local-first para Windows, feito com Tauri 2, React,
TypeScript, Rust e SQLite.

## Estado atual

Este repositório implementa a fundação e a primeira fatia vertical:

- dashboard e lista pesquisável de transações;
- banco SQLite com migration e valores em centavos;
- importação CSV/OFX e PDF textual do Sicoob com prévia, sessão temporária e commit atômico;
- deduplicação por ID externo ou fingerprint;
- categorização automática por regras locais, com prioridade e revisão;
- categorias brasileiras hierárquicas e distinção de transferências;
- aprendizado opcional após correções e aplicação retroativa com prévia;
- onboarding local com perfil, renda de referência e configuração da primeira conta;
- edição posterior do perfil e comparação da renda planejada no dashboard;
- permissões mínimas do seletor nativo;
- testes TypeScript/Rust e CI para Windows.

O build web usa dados fictícios e serve como demonstração. No executável Tauri, os
dados vêm exclusivamente do SQLite local.

## Executar a demonstração web

```powershell
npm install
npm run dev
```

## Executar o desktop

Instale Rust stable com alvo MSVC, Visual Studio Build Tools (Desktop development
with C++) e WebView2. Depois:

```powershell
npm install
npm run tauri dev
```

## Testes e build

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## CSV aceito nesta fatia

O cabeçalho deve conter equivalentes de `data`, `descrição` e `valor`; delimitadores
vírgula e ponto-e-vírgula são detectados. Datas ISO e brasileiras e valores como
`1.234,56` são normalizados. OFX aceita lançamentos `STMTTRN`.

PDFs textuais de extrato de conta corrente do Sicoob são validados pelo cabeçalho,
limitados a 15 MB e interpretados pelo indicador de crédito/débito `C`/`D`. Linhas de
saldo e resumo são ignoradas. PDFs digitalizados como imagem ainda exigem OCR e não
são aceitos silenciosamente.

## Segurança e próximos marcos

A arquitetura impede acesso direto do frontend ao banco e não registra conteúdo
financeiro. A integração de SQLCipher e Windows Credential Manager/DPAPI ainda é um
marco obrigatório antes de usar dados reais: o SQLite desta versão não está
criptografado. Também permanecem para as fases seguintes CRUD completo, regras,
parcelas/transferências, orçamentos, backup e instalador assinado.
