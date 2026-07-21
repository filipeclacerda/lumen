---
name: generate-lumen-release
description: Preparar, publicar e verificar uma nova versao do Lumen a partir das mudancas desde a ultima release publicada. Usar quando o usuario pedir para gerar versao, preparar ou publicar release, atualizar o CHANGELOG, escolher o proximo SemVer, produzir release notes ou verificar seus artefatos; cobrir changelog, sincronizacao dos manifests, validacoes locais e fluxo GitHub em duas fases.
---

# Gerar release do Lumen

Preparar uma release reproduzivel a partir do historico e do diff reais. Manter commit, tag, push e publicacao como etapas explicitamente autorizadas. A publicacao usa duas fases: criar o draft com notas, gerar os artefatos, publicar e somente entao executar o artifact check.

## 1. Fazer a pre-validacao

1. Trabalhar na raiz do repositorio Lumen e ler `AGENTS.md`, `README.md`, `CHANGELOG.md`, `package.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` e `.github/workflows/artifact-check.yml`.
2. Executar `git status --porcelain`. Interromper antes de qualquer alteracao se houver mudancas locais, inclusive arquivos nao rastreados. Explicar o que precisa ser commitado, guardado ou removido; nunca descartar trabalho do usuario.
3. Executar:

   ```powershell
   python .agents/skills/generate-lumen-release/scripts/version_files.py check --root .
   ```

   Interromper se `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, o pacote `lumen` de `src-tauri/Cargo.lock` e `src-tauri/tauri.conf.json` nao estiverem sincronizados.

4. Nao ler, imprimir, alterar ou validar o conteudo de chaves `*.key*` ou secrets do updater.

## 2. Encontrar a release-base

1. Consultar a release publicada mais recente com `gh release view --json tagName,isDraft,isPrerelease,publishedAt,url`. Aceitar somente release nao draft e nao prerelease cuja tag exista localmente e seja ancestral de `HEAD`.
2. Exigir, tambem no caminho principal do GitHub, que a versao sem o prefixo `v` coincida com a versao sincronizada nos manifests e com uma entrada do `CHANGELOG.md`.
3. Se GitHub ou `gh` estiver indisponivel, usar `git describe --tags --abbrev=0 --match "v[0-9]*"` e aplicar as mesmas verificacoes de ancestralidade, manifests e changelog.
4. Interromper diante de base ausente ou ambigua. Nunca escolher a base pelo maior numero retornado por `git tag`: este repositorio possui uma tag historica `v1.0.0` fora da linha atual.
5. Definir o intervalo como `<tag-base>..HEAD` e confirmar que ele contem mudancas. Nao preparar release vazia.

## 3. Entender todas as mudancas

Inspecionar, no minimo:

```powershell
git log <tag-base>..HEAD --format="%h|%ad|%s" --date=short
git diff <tag-base>..HEAD --name-status
git diff <tag-base>..HEAD --stat
git diff <tag-base>..HEAD
```

Ler os arquivos necessarios para compreender comportamento, migrations, contratos, testes e impacto ao usuario. Nao inferir a release apenas pelos titulos dos commits. Consolidar todas as mudancas relevantes sem transformar o changelog em inventario de arquivos.

Inspecionar os nomes do intervalo completo, nao apenas o diff ainda nao commitado. Interromper se `<tag-base>..HEAD` contiver secrets, chaves, bancos, `dist/`, `target/`, `*.tsbuildinfo` ou outros artefatos proibidos pelo `AGENTS.md`. Pedir um commit de limpeza antes de preparar a release; nao ocultar o problema somente porque o artefato ja foi commitado.

Classificar somente secoes com conteudo:

- `Adicionado`: funcionalidades ou capacidades novas.
- `Alterado`: comportamento, UX, arquitetura ou performance modificados.
- `Corrigido`: defeitos efetivamente reparados.
- `Seguranca`: protecoes ou riscos de seguranca tratados.
- `Testes e qualidade`: cobertura e validacoes relevantes.
- `Projeto`: toolchain, CI, empacotamento ou manutencao sem impacto direto.

Preservar integralmente as entradas historicas do `CHANGELOG.md`. Usar a data local no formato `YYYY-MM-DD`, texto em portugues e afirmacoes sustentadas pelo diff.

## 4. Escolher a versao

Aplicar SemVer por impacto sobre a versao atual sincronizada:

- `major`: qualquer incompatibilidade deliberada com dados, backups, configuracao, integracoes ou comportamento publico suportado.
- `minor`: ao menos uma funcionalidade nova compativel com a versao anterior.
- `patch`: apenas correcoes, documentacao, testes, refatoracao ou manutencao compativel.

Usar volume e abrangencia apenas para explicar a decisao, nunca para substituir o impacto. Registrar uma justificativa curta. Para uma versao `0.x`, manter a mesma regra: uma incompatibilidade deliberada propoe `1.0.0`.

Antes de alterar arquivos, verificar colisao local e remota:

```powershell
git rev-parse --verify --quiet refs/tags/v<NOVA_VERSAO>
gh release view v<NOVA_VERSAO>
```

Interromper se a tag ou release ja existir. Nao apagar ou mover tags automaticamente.

## 5. Preparar os arquivos

1. Inserir no topo do `CHANGELOG.md`, abaixo da introducao, a nova entrada Keep a Changelog com resumo e secoes pertinentes.
2. Sincronizar os cinco campos de versao:

   ```powershell
   python .agents/skills/generate-lumen-release/scripts/version_files.py set <NOVA_VERSAO> --root .
   python .agents/skills/generate-lumen-release/scripts/version_files.py check --root . --expect <NOVA_VERSAO>
   ```

3. Revisar o diff para garantir que o script alterou somente os campos esperados e que nenhuma migration historica foi modificada.
4. Nao criar arquivo separado de release notes por padrao. Derivar no resultado final um Markdown pronto para GitHub a partir da nova entrada do changelog.

## 6. Validar como o CI

Executar em sequencia e interromper na primeira falha real:

```powershell
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --debug --no-bundle
git diff --check
```

Usar `--no-bundle` para nao exigir a chave privada do updater. Remover do diff apenas artefatos gerados ignoraveis; nunca reverter mudancas preexistentes do usuario. Verificar que nao entraram secrets, chaves, dados financeiros reais, bancos, `dist/`, `target/` ou `*.tsbuildinfo`.

## 7. Publicar quando houver autorizacao explicita

Executar esta secao somente quando o usuario autorizar commit, tag, push e publicacao. Em um pedido apenas de preparacao, entregar o resultado do passo 8 e parar antes de qualquer acao remota.

1. Confirmar novamente que o worktree esta limpo, que `HEAD` foi enviado para `origin/main` e que a tag ainda nao existe local ou remotamente.
2. Criar e enviar a tag anotada `v<NOVA_VERSAO>` no commit de release.
3. Criar uma GitHub Release **em draft** para a tag, com o titulo `Lumen v<NOVA_VERSAO>` e as notas derivadas do changelog. Nao usar texto generico.
4. Disparar `Release` por `workflow_dispatch` na ref `main`, informando `tag=v<NOVA_VERSAO>`. O workflow faz checkout da tag, portanto compila exatamente o commit versionado e reutiliza caches salvos em `main`.
5. Aguardar todos os quatro builds, uploads e attestations. Se qualquer job falhar, manter o draft; nao publicar e nao executar o artifact check.
6. Depois de todos os jobs verdes, publicar o draft e confirmar `isDraft=false`, `publishedAt` preenchido e notas presentes.
7. Disparar `Artifact check` por `workflow_dispatch` na ref `main`, com a mesma tag, e aguardar sucesso. Ele valida a release publica, as notas, os instaladores, assinaturas e o `latest.json` do updater.
8. Fazer o teste manual proporcional do aplicativo Tauri empacotado. `gh attestation verify CAMINHO_DO_ARTEFATO --repo filipeclacerda/lumen` continua sendo uma verificacao de proveniencia complementar.

Nao tente publicar antes da matriz terminar. Nao rode o artifact check sobre draft: downloads de assets e endpoints publicos podem retornar 404 enquanto a release nao foi publicada.

## 8. Entregar o resultado

Informar:

- release-base e intervalo analisado;
- versao anterior, nova versao e justificativa SemVer;
- arquivos alterados;
- resultado de cada validacao;
- notas da release em Markdown copiavel;
- pendencias manuais, especialmente teste do aplicativo empacotado.

Sugerir a mensagem `chore(release): v<NOVA_VERSAO>`. Se houve autorizacao de publicacao, informar as URLs/runs da matriz e do artifact check; caso contrario, deixar as notas prontas para o draft. Nao alterar secrets.

## Script de versao

Usar `scripts/version_files.py` em vez de substituicoes globais. O script valida a versao atual, rejeita downgrade e tag local conflitante, altera somente os cinco locais conhecidos e restaura os arquivos originais se a escrita falhar. Tratar a verificacao remota feita no passo 4 como obrigatoria; o script nao substitui essa consulta de rede.
