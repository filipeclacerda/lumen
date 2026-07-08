# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.4.0] - 2026-07-08

Foco em refinar a entrada de valores monetários e a navegação em telas densas,
além de trazer filtros avançados para as transações.

### Adicionado

- **Filtros avançados nas transações**: período (data inicial/final), status e
  tipo de movimento, além de faixa de valor absoluto (mínimo/máximo).
- **Zoom em nível de app**, com atalhos para aumentar, diminuir e restaurar o
  zoom, mantendo o layout do dashboard e dos relatórios ajustado às novas
  escalas.

### Alterado

- Campos de valor monetário em Orçamento, Categorias/Regras, Onboarding,
  Recorrências, Relatórios e Configurações passam a usar o componente
  `MoneyInput`, com formatação e validação consistentes em todo o app.

### Corrigido

- Corrigida a grafia de "Lúmen" para "Lumen" em textos e strings do app.
- Corrigido o `base path` do Vite para relativo, evitando problemas de
  carregamento de assets na build instalada.

### Projeto

- Versão atualizada para `0.4.0`.

## [0.3.7] - 2026-07-08

Patch para corrigir a inicialização da build instalada no Windows.

### Corrigido

- Corrigido o reparo automático de checksums de migrações SQL quando builds com
  finais de linha diferentes (`LF`/`CRLF`) já haviam criado ou atualizado o banco
  local, evitando que o app instalado abrisse em tela branca e encerrasse durante
  o `setup`.
- O erro interno de inicialização do banco passa a aparecer com mais detalhes nos
  logs de `stderr`, facilitando diagnóstico de builds instaladas.

### Projeto

- Versão atualizada para `0.3.7`.
- Migrações SQL passam a ter final de linha `LF` fixado via `.gitattributes`.

## [0.3.6] - 2026-07-08

Foco em tornar o dashboard e os relatórios mais úteis no dia a dia, com
orçamento por categoria, gráficos padronizados e uma leitura mais clara da sobra
mensal.

### Adicionado

- **Tela de Orçamento** para definir limites mensais por categoria de despesa,
  acompanhar gasto, disponível, status do limite e projeção do mês.
- **Sobra mensal no dashboard**, substituindo o gráfico de patrimônio por uma
  visão direta de receitas menos gastos e investimentos.
- **Próximos vencimentos** no dashboard para acompanhar lançamentos pendentes dos
  próximos 15 dias.
- **Exportação de relatórios em PDF** e melhorias nas exportações para análise
  fora do app.
- **Comando rápido (`Ctrl+K`)** para navegar entre telas e buscar categorias,
  regras e transações.

### Alterado

- **Gráficos centralizados em Recharts** com componentes compartilhados,
  tooltips, formatação monetária e paleta única para dashboard e relatórios.
- A aba **Categorias** dos relatórios passa a cobrir gastos, receitas e
  investimentos com textos e tooltips corretos para cada tipo.
- O gráfico **Evolução dos gastos**, no filtro **Mês**, passa a comparar o mês
  atual com o mês anterior.
- Relatórios e dashboard ganharam cálculos e indicadores mais completos,
  incluindo metas, tendências por categoria, origem dos gastos e concentração.
- Importação e transações receberam melhor tratamento de transferências
  vinculadas, pendências e correções que podem virar regras futuras.

### Corrigido

- Removido o outline/foco visual que permanecia ao clicar nos gráficos.
- Ajustadas cores de tooltip e hover nos gráficos de categorias para manter
  contraste no tema escuro.
- Corrigidos sinais e agrupamentos de transferências para evitar que sejam
  somadas como despesa.
- Corrigido o tratamento de recorrências no dia 31 e dos vínculos entre pernas
  de transferências.
- O CI deixa de tentar assinar artefatos de updater nos testes.

### Projeto

- Versão atualizada para `0.3.6`.
- Configuração do Vite ajustada para melhorar watch e suporte ao Vitest.
- Arquivos `*.tsbuildinfo` e worktrees locais da `.claude` passam a ser
  ignorados pelo Git.

## [0.3.5] - 2026-07-07

Foco em preparar o Lumen para avisar e instalar novas versões pelo próprio app.

### Adicionado

- **Aviso de nova versão** com banner persistente e modal de instalação quando
  houver atualização disponível.
- **Instalação pelo app** usando o updater oficial do Tauri, com download,
  instalação e reinício automático do Lumen.
- **Checagem manual de atualização** na tela de Configurações para builds
  instalados.
- **Artefatos de updater assinados** no build Tauri, com endpoint apontando para
  o `latest.json` publicado nas releases do GitHub.

### Alterado

- O fluxo de release passa a receber `TAURI_SIGNING_PRIVATE_KEY` e
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` pelos secrets do GitHub Actions.
- A checagem de atualização fica desabilitada em `tauri dev`, evitando erros
  locais enquanto não existe uma release publicada.
- A versão do app foi alinhada em `0.3.5` nos manifests do frontend e do Tauri.

### Segurança

- Arquivos de chave (`*.key*`) passam a ser ignorados pelo Git para evitar que a
  chave privada do updater seja commitada por acidente.

## [0.3.4] - 2026-07-07

Esta versão amplia o Lumen com mais automação no dia a dia, relatórios mais
completos e uma importação mais inteligente.

### Adicionado

- **Nova tela de Recorrências** para cadastrar receitas e despesas fixas,
  pausar/reativar lançamentos e gerar pendências do mês.
- **Sugestão de categoria por histórico**: o Lumen passa a reconhecer
  estabelecimentos recorrentes e sugerir categorias quando houver confiança
  suficiente.
- **Gestão de estabelecimentos e apelidos**, com agrupamento por chave de
  estabelecimento e opção de renomear nos relatórios.
- **Relatórios expandidos** com evolução mensal, ranking de categorias,
  principais estabelecimentos, metas, tendências por categoria e indicadores de
  faturas.
- **Novo seletor de categorias** com busca, ícones, cores, hierarquia e filtro
  por tipo de movimento.

### Alterado

- Categorias reorganizadas por tipo: receitas, despesas, investimentos e
  transferências.
- Suporte a reordenação e hierarquia de categorias.
- Importação de CSV mais inteligente, com categorias sugeridas por regra ou
  histórico e criação rápida de regra a partir de uma correção.
- Dashboard com navegação por mês, fluxo de caixa dos últimos meses, taxa de
  poupança, ritmo diário e projeção de gastos.
- Tela de transações com filtro por categoria, seleção em massa, categorização em
  lote, exclusão com desfazer e criação de regra a partir de correções manuais.

### Corrigido

- Ajuste no cálculo de faturas de cartão: compras, estornos e pagamentos agora
  entram com a convenção correta de sinal.
- Correção dos totais de fatura já existentes por migration.
- Transferências passam a ser tratadas separadamente, evitando que sejam somadas
  como despesa.

### Projeto

- Versão atualizada para `0.3.4`.
- README atualizado com badges e link correto do repositório.
- Adicionados templates de issues, template de pull request, guia de
  contribuição e código de conduta.

## [0.3.0] - 2026-06-28

Foco em tornar a importação de faturas de cartão mais clara, guiada e à prova de
erros, com cadastro rápido de cartão sem sair do fluxo.

### Adicionado

- **Cadastro rápido de cartão durante a importação**: um seletor de cartões com
  botão **+** ao lado permite cadastrar um novo cartão sem sair da tela, por meio
  de um modal de cadastro rápido. Quando ainda não há cartões, um estado vazio
  amigável orienta o primeiro cadastro.
- **Checklist de pré-requisitos** na tela de mapeamento de CSV: mostra em tempo
  real os passos que faltam (data, valor, descrição, cartão de destino e
  vencimento) e libera a prévia quando tudo está completo.
- **Orientação de fluxo** na importação personalizada, explicando o passo a passo
  até a prévia.
- **Identificação dos campos obrigatórios** com asterisco (`*`) e legenda.

### Corrigido

- A **prévia da fatura de cartão não aparecia** quando não havia conta bancária
  cadastrada — a verificação exigia conta bancária mesmo em importações de cartão.
- **CSV reconhecido por um layout salvo era enviado ao parser do template oficial**,
  resultando em `Dados inválidos: CSV de fatura inválido`. Agora arquivos com
  layout salvo seguem o fluxo de mapeamento e usam o parser correto.
- O **cartão pré-selecionado não era considerado selecionado** até trocar e voltar;
  o seletor agora reflete o cartão padrão imediatamente.
- **Foco preso no botão de fechar (X)** do modal de cadastro de cartão, que roubava
  o foco a cada tecla digitada.
- Padronização da **altura dos seletores** e do alinhamento do asterisco de campo
  obrigatório na tela de mapeamento.

### Alterado

- As opções de mapeamento de colunas passam a listar os papéis obrigatórios
  primeiro (**Data, Valor, Descrição**); "Valor com sinal" foi renomeado para
  **"Valor"**.
- O modal de cadastro de cartão agora usa o componente de diálogo acessível (foco
  inicial no campo, fechamento com `Esc` e restauração do foco ao sair).
- **CI/Release**: adicionado cache de Rust aos workflows de integração e de
  publicação, acelerando os builds.

[0.3.0]: https://github.com/filipeclacerda/lumen/compare/v0.2.2...v0.3.0
[0.3.4]: https://github.com/filipeclacerda/lumen/compare/v0.3.0...v0.3.4
[0.3.5]: https://github.com/filipeclacerda/lumen/compare/v0.3.4...v0.3.5
[0.3.6]: https://github.com/filipeclacerda/lumen/compare/v0.3.5...v0.3.6
[0.3.7]: https://github.com/filipeclacerda/lumen/compare/v0.3.6...v0.3.7
[0.4.0]: https://github.com/filipeclacerda/lumen/compare/v0.3.7...v0.4.0
