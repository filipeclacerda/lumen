# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.3.5] - 2026-07-07

Foco em preparar o Lúmen para avisar e instalar novas versões pelo próprio app.

### Adicionado
- **Aviso de nova versão** com banner persistente e modal de instalação quando
  houver atualização disponível.
- **Instalação pelo app** usando o updater oficial do Tauri, com download,
  instalação e reinício automático do Lúmen.
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
[0.3.5]: https://github.com/filipeclacerda/lumen/compare/v0.3.4...v0.3.5
