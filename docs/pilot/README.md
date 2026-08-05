# Piloto de validação do Lumen

Este diretório transforma o plano de divulgação em uma rotina de pesquisa
executável durante 30 dias. O objetivo é descobrir se pessoas reais conseguem
instalar o Lumen, chegar a uma visão financeira útil e voltar depois de 14 dias
antes de ampliar funcionalidades ou divulgação.

## Limites do piloto

- Não adicionar telemetria ao aplicativo.
- Não registrar nomes, e-mails, arquivos bancários, saldos, contas, CPFs ou
  outros dados financeiros no Git.
- Identificar participantes somente como `P01` a `P20`.
- Manter a planilha preenchida fora do repositório e compartilhá-la apenas com
  quem conduz a pesquisa.
- Usar as [fixtures fictícias](fixtures/) quando a pessoa não quiser importar
  dados próprios.
- Não tratar downloads do GitHub como pessoas, instalações ou retenção.
- Não iniciar funcionalidades amplas antes de classificar os bloqueios
  observados.

## Definições usadas

| Marco | Definição operacional |
| --- | --- |
| Download confirmado | A pessoa afirma que baixou um pacote do Lumen. |
| Instalação confirmada | O aplicativo abre pela primeira vez na máquina da pessoa. |
| Primeiro dado | A pessoa importa um arquivo ou salva o primeiro lançamento manual. |
| Primeiro valor | A pessoa encontra uma visão, pendência ou decisão útil com os próprios dados ou com a fixture. |
| Sem ajuda | O marco é concluído sem instrução do moderador além do enunciado da tarefa. |
| Retorno D14 | A pessoa abre e usa o Lumen no 14º dia, com tolerância de dois dias antes ou depois. |
| Entrevista detalhada | Conversa de 15 a 30 minutos que cobre instalação, primeiro uso, retorno e limitações. |
| Decisão prática | A pessoa consegue citar uma ação tomada com o Lumen, sem registrar valores ou dados identificáveis. |

O tempo até o primeiro valor começa quando o aplicativo abre pela primeira vez
e termina quando a pessoa consegue explicar o que aprendeu ou decidiu.

## Execução em 30 dias

### Preparação

1. Gere uma linha de base dos sinais públicos:

   ```powershell
   pwsh -File scripts/pilot-public-signals.ps1
   ```

2. Copie a planilha `lumen-piloto-30-dias.xlsx` para uma pasta privada.
3. Monte fora do Git a lista de 15 a 20 convidados e associe cada pessoa a um
   ID anônimo.
4. Execute o [preflight e o smoke empacotado](smoke-build-empacotada.md).

### Semana 1 — instalação e primeiro valor

- Conduza a sessão de ativação descrita em
  [roteiro-sessao.md](roteiro-sessao.md).
- Registre download, instalação, primeiro dado, primeiro valor, duração e ajuda
  necessária.
- Não explique a interface antes de a pessoa tentar.
- Abra um bloqueio quando a pessoa não conclui, hesita de forma relevante ou
  precisa de ajuda.

### Semana 2 — três maiores bloqueios

Na planilha, cada bloqueio recebe:

- frequência observada;
- impacto de 1 a 5;
- esforço estimado de 1 a 5;
- pontuação `frequência × impacto ÷ esforço`;
- critério de aceitação e estado do reteste.

Corrija somente os três primeiros por pontuação, exceto quando um bloqueio de
integridade, perda de dados ou segurança exigir prioridade imediata. Cada
correção precisa ser retestada por alguém que não participou da implementação.

### Semana 3 — rotina de retorno

Use recursos já existentes para testar duas rotinas:

1. **Revisão semanal:** abrir Pendências, resolver ao menos um item, revisar
   próximos lançamentos e conferir o orçamento.
2. **Fechamento mensal:** conferir saldo, revisar gastos por categoria e
   estabelecimento, comparar orçamento e registrar uma decisão prática.

Não implemente lembretes ou novas telas antes de verificar se essas rotinas
fazem sentido para os participantes.

### Semana 4 — retorno e decisão

- Refaça o contato no D14.
- Conduza pelo menos cinco entrevistas detalhadas.
- Consolide os três maiores bloqueios, pedidos repetidos e decisões práticas.
- Gere novamente os sinais públicos para contexto, sem misturá-los ao funil.
- Use os critérios abaixo para decidir a próxima etapa.

## Critérios de sucesso

| Indicador | Meta |
| --- | ---: |
| Instalações confirmadas | 10 |
| Pessoas chegando ao primeiro valor | 5 |
| Primeiro valor sem ajuda após as correções | 70% |
| Pessoas que retornam no D14 | 3 |
| Entrevistas detalhadas | 5 |
| Pessoas retidas que citam uma decisão prática | Todas |

## Regras de decisão

- **Poucas instalações:** priorizar instalador, avisos do sistema, instruções e
  confiança.
- **Instalações sem primeiro valor:** priorizar onboarding, importação e
  clareza da primeira visão útil.
- **Primeiro valor sem retorno:** priorizar a revisão semanal e o fechamento
  mensal antes de adicionar relatórios.
- **Retenção com pedidos repetidos:** considerar somente os pedidos citados por
  pelo menos três participantes ou ligados a um bloqueio crítico.
- **Metas atingidas:** preparar divulgação mais ampla com evidências e relatos
  autorizados.

## Artefatos

- [Roteiro de sessões](roteiro-sessao.md)
- [Smoke da build empacotada](smoke-build-empacotada.md)
- [Extrato bancário fictício](fixtures/extrato-ficticio.csv)
- [Fatura fictícia](fixtures/Fatura2026-08-10.csv)
- `scripts/pilot-public-signals.ps1` para sinais públicos
- `scripts/pilot-preflight.ps1` para qualidade e build

