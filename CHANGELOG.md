# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.9.0] - 2026-07-25

Atualização ampla de confiabilidade e organização financeira, com novos fluxos
de conciliação, revisão de pendências e importação guiada sem abrir mão do
armazenamento local.

### Adicionado

- **Central de revisão de dados** para reunir transações sem categoria ou
  pendentes, saldos que precisam ser conferidos e pagamentos de cartão ainda
  não conciliados.
- **Conferência de saldo por conta** com registro do saldo informado em uma
  data, comparação com o razão e projeções de saldo realizado, pendente, futuro
  e mínimo, sem transformar diferenças em receitas ou despesas.
- **Conciliação de pagamentos de cartão** entre débito bancário, crédito no
  cartão e fatura, com escolha explícita dos vínculos e possibilidade de
  desfazer a conciliação.
- **Parcelamento manual no cartão** de 2 a 48 vezes, preservando o total exato em
  centavos e apresentando previamente datas e valores das parcelas.
- **Revisão guiada das importações** por estabelecimento, com sugestões de
  categoria, ações em lote, tutorial dedicado e tratamento separado de Pix e
  transferências entre contas próprias.
- **Identificação confirmada de Pix importados**: descrições genéricas ficam
  pendentes até o usuário associá-las a um estabelecimento existente ou a um
  novo nome, preservando o texto original do banco.
- **União segura de categorias** com prévia do impacto e migração de
  transações, regras, recorrências, subcategorias e metas compatíveis.
- **Seletor de calendário compartilhado** para datas e meses, com navegação por
  teclado e uso consistente em importações, recorrências, relatórios e
  transações.

### Alterado

- O onboarding foi redesenhado para registrar objetivo financeiro, meta mensal
  e modo inicial de uso, além de oferecer uma orientação mais clara para
  importar dados, lançar manualmente ou conhecer o aplicativo.
- Transferências vinculadas agora podem ser editadas como uma unidade,
  desvinculadas com restauração das categorias anteriores, excluídas e
  recuperadas com as duas pernas preservadas.
- Orçamentos e metas por categoria podem incluir subcategorias, e relatórios,
  patrimônio, projeções e indicadores passam a compartilhar regras financeiras
  mais consistentes para sinais, vínculos e lançamentos excluídos.
- A tela de contas e cartões passa a destacar previsões, risco de saldo negativo
  e conciliações pendentes; a janela principal usa uma área maior e centralizada
  quando o monitor comporta 1600 × 900 px.
- Tutoriais, seletores de categoria, modais e estados de erro receberam
  melhorias de foco, posicionamento, continuidade, responsividade e anúncios
  para leitores de tela.

### Corrigido

- Compras, estornos e pagamentos de faturas passam a manter totais e sinais
  separados corretamente, incluindo a correção dos dados existentes por
  migration.
- Ações genéricas deixam de alterar isoladamente lançamentos protegidos por
  vínculos de transferência ou pagamento de cartão.
- O vocabulário de categorização foi ampliado e teve duplicidades removidas,
  melhorando sugestões sem classificar Pix genéricos automaticamente.
- Invalidações de cache após mutações financeiras foram centralizadas para
  evitar resumos, relatórios, orçamento e patrimônio desatualizados.

### Testes e qualidade

- Ampliada a cobertura de importação, conciliação, parcelamento, transferências,
  categorias, orçamento, onboarding, relatórios, saldos, seletores, tutoriais e
  invalidação de consultas.
- Adicionadas validações de compatibilidade entre tipos de categoria, métricas
  financeiras compartilhadas, projeção de fluxo de caixa e um limite de erro
  amigável para telas carregadas sob demanda.
- Novas migrations aditivas preservam o histórico de categorias, checkpoints,
  parcelas, vínculos e identificação de estabelecimentos, com índices e
  restrições para reforçar a integridade local.

### Projeto

- O fluxo de release passa a localizar drafts pela listagem de releases e usa a
  permissão necessária para validar suas notas antes da matriz de builds.
- Adicionados o patrocínio pelo GitHub, um plano de divulgação e fontes locais
  para a nova apresentação do onboarding.

## [0.8.1] - 2026-07-21

Correções de usabilidade nos seletores de categoria e refinamentos na janela
desktop, com um fluxo de publicação mais verificável.

### Alterado

- A janela inicial do Lumen agora abre em 1280 × 800 px, preservando os limites
  mínimos já definidos para a aplicação.

### Corrigido

- O seletor de categorias passa a abrir acima de contêineres com recorte,
  reposiciona-se dentro da área visível e continua acessível durante a seleção.

### Testes e qualidade

- Adicionado teste de interação do seletor de categorias renderizado no portal.

### Projeto

- O fluxo de release agora valida o draft e suas notas antes dos builds, gera
  artefatos a partir da tag versionada e conta com uma verificação posterior da
  release publicada, instaladores, assinaturas e manifesto do updater.

## [0.8.0] - 2026-07-21

Versão de onboarding e acabamento da experiência desktop, com orientação para
quem está começando e melhorias na distribuição do aplicativo.

### Adicionado

- **Guia rápido após o onboarding**: um tour interativo em sete etapas apresenta
  importação, transações, filtros, visão geral, relatórios e categorias, com
  opção de avançar, voltar, pular ou fechar e possibilidade de reinício nas
  configurações.
- **Abertura de links no navegador padrão**: atalhos e links externos das
  configurações agora usam o navegador do sistema.

### Alterado

- **Onboarding simplificado**: o cadastro inicial ficou mais direto, deixando a
  personalização detalhada de categorias para o uso normal do aplicativo.
- Controles, paginação, seletores, sidebar e barra de título receberam ajustes
  de estados visuais, contraste e acessibilidade.
- Contas e cartões ganharam uma composição visual mais consistente, e os ícones
  do aplicativo foram atualizados para as plataformas suportadas.

### Corrigido

- A janela desktop permanece oculta até o primeiro carregamento da interface,
  evitando exibir a superfície branca do WebView antes do Lumen.

### Testes e qualidade

- Adicionados testes para o fluxo revisado de onboarding e para o estado,
  persistência e interação do guia rápido.

### Projeto

- O workflow de release passou a incluir bundles `.app` do macOS e a validar a
  presença dos manifests e assets assinados do updater em todas as plataformas.

## [0.7.0] - 2026-07-20

Foco em tornar a manutenção dos dados locais mais preventiva e deixar a
navegação e as configurações mais rápidas no uso diário.

### Adicionado

- **Lembretes de backup local**: o Lumen avisa quando uma nova cópia está
  pendente, permite adiar por um dia e oferece ciclos de 7, 14 ou 30 dias, além
  da opção de desativar o lembrete.
- **Paleta de comandos ampliada** com ações para criar lançamentos, contas,
  importações e limites de orçamento, histórico recente e busca por contas,
  categorias, regras e transações.
- **Navegação voltar/avançar na barra de título desktop**, respeitando o
  histórico disponível da aplicação.

### Alterado

- **Configurações reorganizadas** em Geral, Aparência, Dados e backup,
  Privacidade, Sobre e Zona de risco, com a seção selecionada preservada na URL
  e layout adaptado para telas menores.
- Tema do sistema, modo claro/escuro, zoom e densidade da sidebar passam a ser
  gerenciados como preferências visuais unificadas e persistidas no dispositivo.
- A sidebar passa a agrupar as áreas por acompanhamento, gerenciamento e
  planejamento, mantendo Configurações como ação utilitária.
- Exportação, backup, restauração e limpeza passam por um fluxo centralizado;
  a limpeza pode criar um backup antes de apagar os dados.

### Corrigido

- A sincronização de snapshots no Windows passa a abrir o arquivo com permissão
  de escrita, evitando falhas de `FlushFileBuffers` após um backup válido.

### Segurança

- Operações de dados concorrentes agora são bloqueadas e, após preparar uma
  restauração ou limpeza, novas alterações ficam indisponíveis até o aplicativo
  reiniciar.

### Testes e qualidade

- Ampliada a cobertura de preferências visuais, lembretes de backup, operações
  de dados, navegação, paleta de comandos, restauração, limpeza e bloqueio até o
  reinício.

### Projeto

- O workflow de release passa a publicar nomes de artefatos explícitos por
  sistema e arquitetura e a gerar attestations de proveniência no GitHub.
- Adicionados manifests do Windows Package Manager para a versão `0.6.0` e
  ajustada a execução do CI para evitar builds redundantes.

## [0.6.0] - 2026-07-20

Busca global mais acessível no aplicativo desktop e distribuição ampliada para
Windows, Linux e macOS.

### Adicionado

- **Busca rápida na barra de título**: o aplicativo desktop passa a exibir um
  controle central para abrir a paleta de comandos, com indicação do atalho
  `Ctrl+K` e suporte equivalente ao atalho no macOS.

### Alterado

- **Releases multiplataforma**: o workflow de publicação passa a gerar builds
  para Windows, Linux (`deb` e AppImage) e macOS em Apple Silicon e Intel.

### Corrigido

- Operações atômicas de arquivo no Windows agora preservam o erro real de cada
  tentativa, evitando que uma espera entre tentativas substitua a causa da falha
  por uma mensagem incorreta de sucesso do sistema operacional.

### Testes e qualidade

- Adicionados testes para a abertura da paleta pela barra de título e para a
  disponibilidade do controle de busca nas variações desktop.

## [0.5.0] - 2026-07-19

Versão de recursos e refinamentos de uso diário: planejamento de recebimento,
organização de estabelecimentos e uma interface desktop mais coesa.

### Adicionado

- **Regra de recebimento no 5º dia útil**: o perfil e o onboarding agora
  permitem escolher entre um dia fixo, o último dia do mês ou o 5º dia útil.
  A regra é persistida e validada pelo aplicativo.
- **Janela desktop integrada**: o modo Tauri passa a oferecer barra de título
  própria com ações de minimizar, maximizar/restaurar e fechar, preservando os
  controles nativos no macOS e o fallback sem moldura no navegador.
- **Gestão de estabelecimentos ampliada**: busca por nome original ou apelido,
  ordenação, edição/remoção de apelidos e acesso direto aos lançamentos daquele
  estabelecimento.
- **Guia de preparação de releases** com validação de versões sincronizadas,
  changelog, histórico, artefatos e equivalência com o CI.

### Alterado

- **Categorias e seletores** receberam uma apresentação hierárquica mais clara,
  com resumo, filtros por tipo, prévia durante a edição e busca por categoria.
- **Relatórios por categoria** destacam o total e a distribuição, com lista
  navegável e interação por teclado para detalhar tendências.
- **Interface e navegação** foram refinadas com logo consistente, sidebar mais
  compacta, estados de carregamento mais informativos, paleta de comandos mais
  clara e paginação sem troca brusca de conteúdo.
- Gráficos, tabelas de transações, exportações e layouts responsivos passam a
  ter melhor foco, contraste, rolagem e uso em telas menores.

### Corrigido

- Exportações em PDF agora preservam texto em português, incluindo acentos e
  símbolos compatíveis com a codificação WinAnsi.
- A lista de estabelecimentos ignora lançamentos excluídos e pernas de
  transferência, aplica a busca antes da paginação e usa ordenação estável.

### Testes e qualidade

- Adicionados testes para regra de recebimento, gerenciamento de
  estabelecimentos, paginação, estados assíncronos, paleta de comandos e barra
  de título desktop.
- Removido do versionamento o artefato gerado `tsconfig.app.tsbuildinfo`.

## [0.4.2] - 2026-07-10

Pacote de integridade focado em proteger dados financeiros durante backup,
restauração, importação e edição de transações vinculadas.

### Adicionado

- **Sistema de design documentado**: contribuidores agora encontram no
  `AGENTS.md` e em `docs/design-system.md` os tokens, componentes, escalas de
  controles, critérios de responsividade e acessibilidade usados pelo Lumen.
- **Paginação reutilizável** para lançamentos, faturas, regras e
  estabelecimentos, com páginas numeradas, seleção de tamanho e navegação por
  teclado.
- **Select reutilizável** com lista acessível, navegação por teclado e suporte
  a opções desabilitadas, aplicado aos formulários que antes dependiam do
  controle nativo.

- **Restauração com confirmação explícita**: o usuário precisa digitar
  `RESTAURAR` antes de substituir os dados atuais; após a validação, o Lumen
  reinicia automaticamente para aplicar o backup.
- **Recuperação de restaurações interrompidas**: o startup reconhece estados
  intermediários e mantém uma cópia de rollback até o novo banco abrir,
  migrar e passar pelas verificações de integridade.
- **Validação completa de backups**: `integrity_check`, chaves estrangeiras,
  histórico e checksums de migrations, tabelas, colunas e índices críticos são
  conferidos antes da ativação.
- **Testes de regressão para integridade financeira**, cobrindo WAL, rollback no
  Windows, migrations incompatíveis, parsing monetário, deduplicação,
  importações atômicas, transferências, pagamentos de fatura e restauração pela
  interface.

### Alterado

- **Telas densas passam a seguir uma hierarquia visual comum**: transações,
  filtros, ações de tabela, paginação e seletores adotam tokens, superfícies e
  tamanhos de controle consistentes.
- **Relatórios, faturas e estabelecimentos** passam a consultar coleções
  paginadas, reduzindo o volume renderizado por tela.
- **Gráficos compartilhados** usam a paleta semântica do tema e permitem
  selecionar categorias por mouse ou teclado.

- **Backup passa a usar snapshot SQLite com `VACUUM INTO`**, incluindo
  transações confirmadas que ainda estejam no WAL, em vez de copiar diretamente
  o arquivo principal após um checkpoint.
- **Publicação e troca de bancos no Windows** passam a usar operações nativas
  com write-through (`ReplaceFileW`/`MoveFileExW`) e arquivo de rollback.
- **Parsing monetário reimplementado com aritmética inteira verificada**, sem
  `f64`; formatos BRL, OFX e CSV configurável continuam suportados, enquanto
  expoentes, `NaN`, infinito, casas decimais inválidas e overflow são rejeitados.
- **Deduplicação de importações bancárias e de cartão** agora respeita a
  precedência de `external_id`, usa fingerprint quando o identificador está
  ausente, considera a conta de destino e ignora lançamentos soft-deleted.
- **Commits de importação bancária e de cartão** revalidam duplicatas dentro da
  mesma transação SQL e só consomem a sessão depois do commit bem-sucedido.
- O editor identifica genericamente lançamentos vinculados e mantém conta,
  data, valor e categoria bloqueados, permitindo apenas corrigir a descrição.

### Corrigido

- Corrigido o comportamento da sidebar: recolher a navegação no desktop não
  ativa mais o drawer modal destinado a telas móveis.
- Corrigidos controles inacessíveis em regras, categorias, faturas, onboarding
  e importação; ações de ícone recebem nome acessível e os fluxos relevantes
  podem ser operados por teclado.
- Corrigido o formulário de recorrências, que podia permanecer disponível antes
  de carregar contas e categorias ou após uma falha nessas dependências.
- Corrigido o fallback web de Configurações: operações exclusivas do desktop
  deixam de aparecer como ações disponíveis no navegador.
- Corrigidas tabelas extensas de prévia e fatura para usarem rolagem responsiva
  e semântica de tabela mais clara.
- Corrigido o popover de ajuda da importação, com estado ARIA, Escape, foco
  inicial e retorno ao controle de origem.

- Corrigido o restore que falhava ao substituir `financa.db` existente no
  Windows e podia deixar o aplicativo preso em novas tentativas de abertura.
- Corrigido o risco de descartar WAL/SHM ou o banco anterior antes de confirmar
  que a restauração era válida e compatível.
- Backups de versões anteriores do Lumen voltam a ser aceitos: a cópia é
  pré-validada, recebe migrations pendentes e só então é validada contra o
  schema atual.
- Corrigido o risco de remover o backup anterior quando a sincronização do novo
  arquivo ou o rollback falhava.
- Corrigidas duplicatas dentro do mesmo arquivo e a condição de corrida entre
  prévia, edição da sessão e confirmação da importação.
- IDs externos passam a ser normalizados antes da comparação e persistência;
  valores vazios são tratados como ausentes.
- Corrigidas somas, módulos e subtrações monetárias que podiam estourar os
  limites de `i64`; o valor mínimo não representável com segurança nos fluxos
  derivados passa a ser rejeitado.
- Comandos genéricos de valor, categoria, edição em massa, exclusão e restauração
  não podem mais alterar apenas uma perna de transferência ou pagamento
  vinculado.
- Pagamentos ligados somente a uma fatura também são reconhecidos como
  transações vinculadas e recebem as mesmas proteções.
- Regras retroativas ignoram transações vinculadas inclusive no `UPDATE`,
  eliminando uma condição de corrida que podia sobrescrever a categoria de uma
  transferência ou pagamento.
- Totais de fatura passam a detectar overflow em vez de produzir valores
  incorretos ou causar panic.
- O reset mantém o marcador quando a limpeza falha, permitindo tentar novamente
  na próxima abertura em vez de informar sucesso sem apagar os dados.

### Segurança

- Arquivos selecionados para backup/restore não podem apontar para o banco vivo,
  staging ou rollback gerenciados pelo Lumen.
- Temporários de restore usam um caminho interno conhecido e recuperável; os
  temporários de backup usam nomes exclusivos no diretório escolhido.
- Erros de banco, arquivo e migration continuam retornando mensagens seguras,
  sem expor SQL, caminhos locais ou dados financeiros.

### Testes e qualidade

- Frontend ampliado para **21 testes**, incluindo paginação e fallback de
  configurações. `npm run check` foi validado para esta versão.

- Backend ampliado de 71 para **95 testes Rust**.
- Frontend ampliado de 8 para **12 testes**, incluindo quatro cenários do fluxo
  de restauração.
- `npm run check`, `cargo test`, `cargo fmt --check` e
  `cargo clippy -- -D warnings` validados no Windows.
- Adicionada dependência target-specific `windows-sys` apenas para as operações
  atômicas de arquivo no Windows.

## [0.4.1] - 2026-07-08

Patch com ajustes de interface: navbar fixa ao tamanho da janela em qualquer
nível de zoom e verificação de atualização mais visível.

### Adicionado

- **Aviso de atualização na abertura**: ao iniciar o app, se houver uma nova
  versão disponível, um modal é exibido automaticamente informando a versão
  atual e a versão disponível para instalação.
- **Versão do app na barra lateral**: número da versão instalada exibido no
  rodapé da sidebar.

### Corrigido

- Corrigida a altura da barra lateral (navbar), que ficava cortada ou distante
  do fim da janela ao aumentar ou diminuir o zoom do app.

### Projeto

- Versão atualizada para `0.4.1`.

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
[0.7.0]: https://github.com/filipeclacerda/lumen/compare/v0.6.0...v0.7.0
[0.9.0]: https://github.com/filipeclacerda/lumen/compare/v0.8.1...v0.9.0
