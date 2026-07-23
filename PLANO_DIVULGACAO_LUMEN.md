# Plano de divulgação do Lumen

## Objetivo

Apresentar o Lumen a usuários reais, validar se as pessoas conseguem instalar, começar a usar e retornar ao produto e aprender quais dores e mensagens geram maior interesse antes de investir em monetização ou mídia paga.

## Posicionamento

O Lumen deve ser apresentado como uma alternativa privada às planilhas e aos aplicativos que exigem conexão bancária, não apenas como mais um gestor financeiro.

### Mensagem principal

> Controle suas finanças no computador sem conectar sua conta bancária e sem enviar seus dados para uma nuvem.

### Promessa curta

> Saia da planilha sem entregar seus extratos para uma nuvem.

### Limites da comunicação

- Comunicar que o processamento e o banco SQLite ficam localmente no computador.
- Não afirmar que o banco é criptografado ou que o produto oferece segurança absoluta; a criptografia nativa ainda não foi implementada.
- Destacar que o Lumen é gratuito, open source e não exige login.
- Não prometer sincronização ou recursos que ainda não existem.

## Públicos prioritários

### Público principal

1. Pessoas que controlam as finanças em Excel ou Google Sheets, mas estão cansadas do trabalho manual.
2. Pessoas que evitam Open Finance, contas obrigatórias e armazenamento financeiro na nuvem.
3. Pessoas que querem importar OFX ou CSV e manter controle sobre os próprios dados.

### Público secundário

- Desenvolvedores e entusiastas de open source.
- Pessoas interessadas em privacidade e software local-first.
- Possíveis contribuidores, revisores e criadores de novos importadores.

O público técnico ajuda a gerar confiança, divulgação, stars e contribuições, mas não deve substituir a busca por usuários finais.

## Ativos já disponíveis

- Landing page com apresentação do produto e download por sistema:
  <https://filipeclacerda.github.io/lumen-landing-page/>
- Releases para Windows, macOS e Linux:
  <https://github.com/filipeclacerda/lumen/releases/latest>
- Repositório público e documentação:
  <https://github.com/filipeclacerda/lumen>
- Posicionamento consolidado: privado, local-first, gratuito e open source.

## Materiais que devem acompanhar o lançamento

1. Vídeo de 45 a 60 segundos mostrando:
   - instalação;
   - importação de um extrato fictício;
   - categorização;
   - visão do mês no dashboard.
2. Carrossel com quatro a seis telas e dados totalmente fictícios.
3. Dataset de demonstração sem informações financeiras reais.
4. Formulário voluntário e curto para feedback.
5. Uma publicação contando por que o Lumen foi criado.

O vídeo deve mostrar o resultado alcançado pelo usuário, sem tentar percorrer todas as funcionalidades.

## Plano de lançamento em 30 dias

### Semana 1 — Piloto acompanhado

- Convidar de 15 a 20 pessoas para usar o Lumen durante duas semanas.
- Priorizar usuários de planilha e pessoas desconfortáveis com conexão bancária.
- Acompanhar diretamente as primeiras instalações.
- Registrar as dúvidas e dificuldades recorrentes.

Perguntas para o piloto:

1. Você conseguiu instalar?
2. Conseguiu importar um arquivo ou cadastrar os primeiros dados?
3. O que impediu ou quase impediu você de continuar?
4. Você trocaria sua planilha pelo Lumen? Por quê?
5. Qual recurso faria você voltar a usar o produto na próxima semana?

### Semana 2 — Produção de conteúdo

- Gravar e editar o vídeo curto.
- Produzir o carrossel com dados fictícios.
- Preparar textos específicos para LinkedIn, TabNews e Reddit.
- Corrigir os principais bloqueios encontrados no piloto.
- Recolher um ou dois depoimentos somente com autorização explícita.

### Semana 3 — Divulgação pública brasileira

- Publicar a história do produto no LinkedIn.
- Publicar um artigo técnico no TabNews.
- Apresentar o produto no r/financaspessoais com foco no problema do usuário.
- Apresentar a arquitetura e os aprendizados no r/brdev.
- Responder comentários e dúvidas durante os primeiros dias.

Cada comunidade deve receber um texto próprio. Não repetir o mesmo anúncio em massa nem pedir votos artificiais.

### Semana 4 — Avaliação e segunda onda

- Consolidar downloads e feedbacks.
- Conversar novamente com quem ainda estiver usando depois de 14 dias.
- Identificar o principal ponto de abandono.
- Publicar um resumo transparente dos aprendizados e melhorias realizadas.
- Decidir se o produto está pronto para Show HN e Product Hunt.

## Estratégia por canal

### LinkedIn

Usar uma narrativa pessoal: problema percebido, razão para criar o Lumen, demonstração curta e convite para feedback. É o melhor canal para alcançar pessoas próximas e construir confiança no criador.

### TabNews

Publicar um artigo com valor técnico, por exemplo:

> Como construí um gestor financeiro local-first com Tauri, Rust e SQLite

Explicar decisões de arquitetura, privacidade, importação e desafios de manter o produto open source. O artigo deve ensinar algo mesmo para quem não instalar o aplicativo.

### Reddit financeiro

Começar pela dor do usuário e declarar claramente que o autor é o criador. Evitar tom de propaganda e pedir feedback sobre instalação, importação e rotina de uso.

### Reddit de desenvolvimento

Explorar arquitetura, testes, Tauri, Rust, SQLite e os aprendizados do projeto. O objetivo principal desse canal é reputação técnica, contribuições e feedback de engenharia.

### Show HN

Usar depois de preparar uma apresentação curta em inglês. O produto deve estar disponível para teste imediato, sem cadastro ou lista de espera. O título pode seguir a linha:

> Show HN: Lumen – A local-first, open-source personal finance desktop app

### Product Hunt

Usar em uma segunda etapa, depois do piloto e da divulgação brasileira. Preparar textos em inglês, pelo menos duas imagens, vídeo e uma primeira mensagem do criador explicando o problema e pedindo feedback.

## Texto-base para divulgação

> Eu criei o Lumen, um gestor financeiro desktop gratuito e open source para quem quer sair da planilha sem entregar seus extratos para uma nuvem.
>
> Ele funciona em Windows, macOS e Linux, não exige login e permite acompanhar contas, cartões, orçamento, recorrências e relatórios, além de importar arquivos OFX e CSV.
>
> Estou procurando pessoas para usá-lo durante duas semanas e me contar o que funcionou, o que travou e o que ainda falta para ele entrar na rotina.
>
> Conheça e baixe: https://filipeclacerda.github.io/lumen-landing-page/

## Conteúdos recorrentes depois do lançamento

- Demonstrações curtas de uma funcionalidade real.
- Antes e depois de uma melhoria solicitada por usuários.
- Bastidores técnicos do desenvolvimento local-first.
- Explicações sobre onde os dados ficam e como funcionam backups e exportações.
- Novos importadores e compatibilidades bancárias.
- Resumos mensais do que foi lançado e do que está sendo estudado.
- Histórias reais de uso, sempre com autorização e sem dados financeiros identificáveis.

## Métricas iniciais de validação

Estas são metas de aprendizado, não previsões de crescimento:

- 30 downloads;
- 10 pessoas confirmando que instalaram;
- 5 pessoas conseguindo importar ou iniciar o cadastro;
- 3 pessoas ainda utilizando depois de 14 dias;
- 5 conversas com feedback detalhado;
- pedidos espontâneos por importadores, sincronização, suporte ou outras conveniências.

Não é necessário adicionar telemetria ao aplicativo. Os dados podem vir das contagens públicas de download do GitHub, das conversas do piloto e de um formulário voluntário.

## Interpretação dos resultados

- Poucas visitas ou downloads: problema de distribuição, mensagem ou confiança.
- Muitos downloads e poucas instalações concluídas: problema no instalador, avisos do sistema ou instruções.
- Instalações sem primeiro uso: problema de onboarding ou excesso de trabalho inicial.
- Primeiro uso sem retorno: o produto ainda não entrou na rotina ou não demonstrou valor recorrente.
- Retenção e pedidos por novos recursos: sinal de que existe base para ampliar a divulgação e estudar monetização.

## Investimento recomendado

Não investir inicialmente em anúncios pagos. Primeiro validar a conversão da landing page, a instalação e o retorno depois de 14 dias.

Um domínio curto pode aumentar memorização e confiança antes de um lançamento maior, mas não é obrigatório para o piloto. Um domínio `.com.br` custa aproximadamente R$ 40 por ano, com base no valor normal informado pelo Registro.br.

## Próxima ação concreta

Montar a lista dos primeiros 20 convidados e produzir o vídeo de um minuto. Depois do piloto, concentrar LinkedIn, TabNews e Reddit na mesma semana, adaptando a história a cada comunidade e acompanhando pessoalmente as respostas.

## Referências de canais

- Product Hunt — como publicar um produto: <https://help.producthunt.com/en/articles/479557-how-to-post-a-product>
- Show HN — regras oficiais: <https://news.ycombinator.com/showhn.html>
- Reddit — política de spam: <https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam>
- Registro.br — informações de domínio: <https://registro.br/dominio/processo-de-liberacao/>
