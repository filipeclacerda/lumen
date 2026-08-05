# Smoke da build Tauri empacotada

Este checklist valida os fluxos críticos do piloto em uma build real. Ele não
substitui os testes automatizados nem deve ser executado sobre o banco financeiro
pessoal do moderador.

## Ambiente seguro

- Use uma máquina virtual ou um usuário limpo do sistema operacional.
- Não reutilize `financa.db`, backups ou extratos reais.
- Confirme que o ambiente não possui uma instalação com dados importantes.
- Use somente as fixtures fictícias deste diretório.
- Se houver qualquer banco anterior, pare e faça backup antes de continuar.

## Preflight

Para validar código e gerar os bundles:

```powershell
pwsh -File scripts/pilot-preflight.ps1 -Bundle
```

Sem `TAURI_SIGNING_PRIVATE_KEY`, o script gera um pacote local sem assinatura.
Esse pacote serve apenas ao piloto interno e não deve ser publicado como release
oficial. O workflow de release continua responsável pela assinatura de produção.

Sem `-Bundle`, o script executa a mesma qualidade e compila a aplicação Tauri em
modo debug sem empacotar.

Registre versão, commit, sistema operacional, pacote instalado e resultado de
cada cenário. Não chame o smoke de concluído apenas porque a compilação passou.

## Cenários obrigatórios

### 1. Instalação e primeira abertura

- Instalar pelo pacote gerado para o sistema.
- Abrir pelo atalho instalado.
- Confirmar que onboarding, textos e tema carregam sem tela vazia.
- Fechar e reabrir o aplicativo.

### 2. Onboarding e primeiro valor

- Concluir o onboarding escolhendo começar por importação.
- Importar [extrato-ficticio.csv](fixtures/extrato-ficticio.csv).
- Revisar prévia, duplicatas e categorias antes de confirmar.
- Confirmar que dashboard, transações e Pendências refletem a importação.
- Reimportar o mesmo arquivo e confirmar que duplicatas não são persistidas.

### 3. Transferência

- Criar duas contas fictícias.
- Registrar uma transferência entre elas.
- Confirmar as duas pernas vinculadas e a neutralidade em receita/despesa.
- Editar, desvincular e restaurar conforme as ações disponíveis.

### 4. Cartão e fatura

- Criar um cartão fictício.
- Importar [Fatura2026-08-10.csv](fixtures/Fatura2026-08-10.csv).
- Verificar compras, parcela e estorno com sinais corretos.
- Relacionar o pagamento fictício importado no extrato com a fatura.
- Desfazer a conciliação e confirmar a reversibilidade.

### 5. Rotina semanal e fechamento mensal

- Abrir Pendências e resolver ao menos um item.
- Conferir próximos lançamentos e orçamento.
- Abrir Relatórios e identificar categoria ou estabelecimento relevante.
- Registrar apenas se foi possível chegar a uma decisão, sem copiar os valores.

### 6. Backup e restauração

- Criar um backup em uma pasta temporária do ambiente isolado.
- Adicionar um lançamento fictício depois do backup.
- Restaurar o backup e confirmar que o lançamento posterior desapareceu.
- Reabrir o aplicativo e verificar contas, importação e relatórios.
- Excluir a pasta temporária somente depois de registrar o resultado.

## Aceite

O smoke está aprovado quando:

- todos os cenários foram executados na build empacotada;
- não houve perda, duplicação ou alteração de sinais financeiros;
- backup restaurado abre após relaunch;
- falhas recuperáveis mostram mensagem e permitem nova tentativa;
- bloqueios encontrados possuem passos, ambiente e critério de reteste.

Se um cenário não puder ser executado, registre como **pendente**; não o converta
em aprovado por inferência a partir de testes unitários ou do build.
