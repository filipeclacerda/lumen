# Publicação no WinGet

O workflow `Publish WinGet catalog` é executado depois que uma GitHub Release
estável é publicada. Ele usa o MSI já anexado à release; não recompila nem altera
instaladores.

Também é possível executá-lo manualmente com uma tag publicada. O modo `dry_run`,
habilitado por padrão na execução manual, valida a release e gera o manifesto como
artefato temporário do workflow sem criar fork, commit ou pull request externo.

## Fluxo

O job do WinGet:

1. exige uma tag `vMAJOR.MINOR.PATCH`, release publicada e não prerelease;
2. baixa apenas `Lumen-v<versão>-windows-x64.msi` e valida o cabeçalho do MSI;
3. verifica se a versão ou um pull request correspondente já existe em
   `microsoft/winget-pkgs`;
4. baixa o WingetCreate oficial, valida sua assinatura Authenticode da Microsoft e
   gera o manifesto de `Lacerda.Lumen`;
5. fora do `dry_run`, submete o manifesto com o WingetCreate.

O NSIS não é enviado: o manifesto upstream possui um único instalador MSI x64, e o
WingetCreate exige que a quantidade de URLs corresponda aos nós de instalador já
existentes.

## Configuração

Crie o secret de repositório `WINGET_CREATE_GITHUB_TOKEN` com um PAT clássico do
GitHub que tenha somente o escopo `public_repo`. O WingetCreate ainda não aceita PAT
fine-grained. O token é fornecido pela variável de ambiente recomendada pelo projeto
e nunca por argumento de linha de comando. Na primeira submissão, o WingetCreate
cria ou reutiliza um fork de `microsoft/winget-pkgs` na conta do token e abre o pull
request upstream.

O `GITHUB_TOKEN` padrão permanece somente leitura. A execução automática em
`release: published` submete o manifesto; a execução manual começa em `dry_run`. A
concorrência é serializada por repositório e execuções em andamento não são
canceladas. Se a versão ou um pull request já existir, a execução termina sem nova
submissão.

Depois que o manifesto for aceito e indexado, a instalação é:

```powershell
winget install --exact --id Lacerda.Lumen
```
