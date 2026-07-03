# Plano de Melhorias - Lúmen

Este documento contém uma análise detalhada da codebase do Lúmen com recomendações de melhorias e correções de bugs para fortalecer o projeto como open source.

---

## 📊 Resumo Executivo

**Versão analisada:** 0.3.0  
**Data da análise:** 2026-07-03  
**Total de issues identificadas:** 20

### Pontos Fortes
- ✅ Arquitetura bem estruturada (Tauri + Rust + React + TypeScript)
- ✅ ADRs documentados para decisões técnicas
- ✅ Testes existentes (frontend e backend)
- ✅ CI/CD configurado com GitHub Actions
- ✅ License MIT definida
- ✅ Changelog seguindo Keep a Changelog

---

## 🐛 Bugs e Issues Críticos

### 1. Vazamento de Estado no Frontend

**Arquivo:** `src/features/transactions/Transactions.tsx:18-20`  
**Severidade:** Média

```typescript
const [notice, setNotice] = useState("");
```

**Problema:** O estado `notice` nunca é limpo automaticamente, podendo causar confusão ao usuário após navegação entre rotas.

**Solução:** Adicionar `useEffect` para limpar após 5 segundos ou ao desmontar o componente.

```typescript
useEffect(() => {
  if (notice) {
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }
}, [notice]);
```

---

### 2. Falta de Validação de Input no Backend

**Arquivo:** `src-tauri/src/domain/money.rs:3-11`  
**Severidade:** Média

```rust
pub fn parse_brl(value: &str) -> Result<i64, AppError> {
    let clean = value.trim().replace("R$", "").replace(' ', "");
    if clean.is_empty() { return Err(AppError::Validation("Valor vazio".into())); }
```

**Problema:** Não há limite máximo para valores, permitindo overflow potencial em transações com valores extremos (ex: 999999999999,99).

**Solução:** Adicionar validação de limites razoáveis (ex: ±R$ 10 bilhões em centavos).

```rust
const MAX_CENTS: i64 = 1_000_000_000_000; // R$ 10 bilhões
let cents = (number * 100.0).round() as i64;
if cents.abs() > MAX_CENTS {
    return Err(AppError::Validation("Valor excede limite permitido".into()));
}
```

---

### 3. SQL Injection Potencial em Parser OFX

**Arquivo:** `src-tauri/src/infrastructure/importer.rs:696-704`  
**Severidade:** Baixa (formato estruturado)

```rust
let tag = |block: &str, name: &str| -> Option<String> {
    let start = block.find(&format!("<{name}>"))? + name.len() + 2;
```

**Problema:** Embora OFX seja um formato estruturado, a função `tag` não sanitiza inputs e usa `format!` dinamicamente.

**Solução:** Usar lista branca de tags OFX válidas em vez de string arbitrária.

```rust
const ALLOWED_TAGS: &[&str] = &["DTPOSTED", "MEMO", "NAME", "TRNAMT", "FITID"];
if !ALLOWED_TAGS.contains(&name) {
    return None;
}
```

---

### 4. Race Condition em Sessões de Importação

**Arquivo:** `src-tauri/src/application/state.rs:14-17`  
**Severidade:** Baixa

```rust
pub struct AppState {
    pub db: SqlitePool,
    pub sessions: Mutex<HashMap<String, ImportSession>>,
    pub credit_card_sessions: Mutex<HashMap<String, CreditCardImportSession>>,
}
```

**Problema:** Múltiplos mutexes separados podem causar deadlocks se uma operação precisar de ambas as sessões simultaneamente.

**Solução:** Unificar em um único mutex ou usar `tokio::sync::RwLock` para leituras concorrentes.

```rust
pub struct AppState {
    pub db: SqlitePool,
    pub sessions: RwLock<ImportSessions>,
}

pub struct ImportSessions {
    pub bank: HashMap<String, ImportSession>,
    pub credit_card: HashMap<String, CreditCardImportSession>,
}
```

---

### 5. Hardcode de Porta no Vite

**Arquivo:** `vite.config.ts:8`  
**Severidade:** Baixa

```typescript
server: {
  port: 1420,
  strictPort: true,
```

**Problema:** `strictPort: true` pode falhar em ambientes onde a porta 1420 está ocupada, impedindo o desenvolvimento.

**Solução:** Mudar para `strictPort: false` ou usar variável de ambiente.

```typescript
server: {
  port: parseInt(process.env.VITE_PORT || "1420"),
  strictPort: false,
```

---

## 📦 Melhorias para Open Source

### Documentação

#### 6. Falta CONTRIBUTING.md

**Prioridade:** Alta

Criar `CONTRIBUTING.md` com:
- Como configurar ambiente de desenvolvimento
- Padrões de código (linting, formatação)
- Como rodar testes
- Processo de PR e code review
- Código de conduta

#### 7. Falta CODE_OF_CONDUCT.md

**Prioridade:** Alta

Adotar Contributor Covenant ou similar para projetos open source.

#### 8. Falta .env.example

**Prioridade:** Média

Criar arquivo de exemplo para variáveis de ambiente (mesmo que o projeto seja local-first).

#### 9. README: Links Quebrados

**Arquivo:** `README.md:173-175`  
**Prioridade:** Média

```bash
git clone https://github.com/seu-usuario/lumen.git
```

**Problema:** URL genérica "seu-usuario" deve apontar para o repositório real.

**Solução:** Atualizar para URL correta do repositório.

---

### Segurança

#### 10. Criptografia do Banco de Dados (Roadmap)

**Arquivo:** `README.md:125-127`  
**Prioridade:** Crítica

> **Nota importante:** o projeto ainda está em evolução. Antes do uso com dados financeiros reais, a integração com criptografia local, como SQLCipher e proteção via Windows Credential Manager/DPAPI, é um marco importante do roadmap.

**Recomendação:** Priorizar esta feature antes de promover o projeto como "production-ready". Dados financeiros sem criptografia são um risco significativo.

**Passos sugeridos:**
1. Adicionar SQLCipher como dependência do SQLite
2. Implementar geração de chave via Windows Credential Manager/DPAPI
3. Criar fluxo de onboarding para senha mestre (opcional)
4. Documentar processo de backup restaurável

#### 11. CSP Muito Restritiva

**Arquivo:** `src-tauri/tauri.conf.json:14`  
**Prioridade:** Baixa

```json
"csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost"
```

**Problema:** `unsafe-inline` em style-src pode permitir XSS se houver injeção de HTML.

**Solução:** Usar hashes ou nonces para estilos inline quando possível.

---

### Código

#### 12. Duplicação de Lógica de Formatação

**Arquivos:** 
- `src/shared/format.ts:7-12`
- `src-tauri/src/domain/money.rs:3-11`

**Prioridade:** Baixa

**Problema:** Duas implementações diferentes de parse de dinheiro BRL.

**Solução:** Unificar lógica ou criar testes de contrato para garantir comportamento idêntico.

```typescript
// Teste de contrato para garantir paridade
it("deve parrear com backend Rust", () => {
  expect(parseMoneyToCents("R$ 1.234,56")).toBe(123456);
  // Valor deve ser idêntico ao parse_brl do Rust
});
```

#### 13. Testes Frágeis de Migração

**Arquivo:** `src-tauri/src/infrastructure/database.rs:19-37`  
**Prioridade:** Baixa

```rust
assert!(category_count >= 20);
assert!(rule_count >= 9);
```

**Problema:** Testes acoplados a números mágicos que quebram com novas migrations.

**Solução:** Testar estrutura e integridade, não contagens específicas.

```rust
// Testar existência de tabelas e índices
let category_exists: bool = sqlx::query_scalar(
    "SELECT EXISTS(SELECT 1 FROM categories WHERE id='income')"
).fetch_one(&pool).await.unwrap();
assert!(category_exists);
```

#### 14. Falta de Tratamento de Erros no Frontend

**Arquivo:** `src/shared/api.ts:30-172`  
**Prioridade:** Média

**Problema:** Funções da API não capturam ou transformam erros do Tauri, podendo vazar detalhes de implementação.

**Solução:** Criar wrapper de tratamento de erros com mensagens amigáveis.

```typescript
export const api = {
  bootstrap: async (): Promise<AppBootstrap> => {
    try {
      if (isTauri()) return invoke("get_app_bootstrap");
      // ...
    } catch (error) {
      console.error("Erro na API:", error);
      throw new Error("Não foi possível carregar os dados. Tente reiniciar o aplicativo.");
    }
  },
  // ...
};
```

#### 15. Hardcode de Demo Data

**Arquivo:** `src/shared/api.ts:4-22`  
**Prioridade:** Baixa

```typescript
const demoTransactions: Transaction[] = [ ... ];
```

**Problema:** Dados hardcoded podem confundir novos contribuidores sobre o fluxo real.

**Solução:** Mover para arquivo separado `src/shared/demo.ts` com comentário explicativo.

---

### Infraestrutura

#### 16. CI: Falta Testes em Múltiplas Plataformas

**Arquivo:** `.github/workflows/ci.yml:5`  
**Prioridade:** Média

```yaml
runs-on: windows-latest
```

**Problema:** Tauri é multiplataforma, mas CI testa apenas Windows.

**Solução:** Adicionar matrix com `ubuntu-latest` e `macos-latest`.

```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [windows-latest, ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
```

#### 17. Release: Falta Changelog Automático

**Arquivo:** `.github/workflows/release.yml:48-49`  
**Prioridade:** Baixa

```yaml
releaseBody: 'Nova versão disponível para download!'
```

**Problema:** Release body genérico não informa mudanças da versão.

**Solução:** Usar ação para extrair changelog do `CHANGELOG.md` baseado na tag.

```yaml
- name: Extract Changelog
  uses: requarks/changelog-action@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    tag: ${{ github.ref_name }}

- name: Create Release
  uses: ncipollo/release-action@v1
  with:
    body: ${{ steps.changelog.outputs.changes }}
```

#### 18. Falta .gitattributes

**Prioridade:** Baixa

Adicionar `.gitattributes` para garantir consistência de line endings (CRLF/LF) entre plataformas.

```
# Auto detect text files and perform LF normalization
* text=auto

# Explicitly declare source files
*.rs text eol=lf
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.json text eol=lf

# Windows scripts should use CRLF
*.bat text eol=crlf
*.ps1 text eol=crlf
```

---

### UX/UI

#### 19. Emoji no README Pode Não Renderizar

**Arquivo:** `README.md:1-291` (múltiplos emojis)  
**Prioridade:** Baixa

**Problema:** Emojis podem não renderizar corretamente em alguns terminais ou leitores de tela.

**Solução:** Manter emojis mas adicionar texto alternativo descritivo.

#### 20. Falta de Feedback de Loading em Ações

**Arquivo:** `src/features/transactions/Transactions.tsx:38-40`  
**Prioridade:** Baixa

```typescript
async function deleteOne(id:string) {
  const count=await api.deleteTransactions([id]);
```

**Problema:** Não há indicador visual durante operação assíncrona de delete.

**Solução:** Adicionar estado `isDeleting` e mostrar spinner ou desabilitar botão.

```typescript
const [isDeleting, setIsDeleting] = useState<string | null>(null);

async function deleteOne(id:string) {
  setIsDeleting(id);
  try {
    const count = await api.deleteTransactions([id]);
    // ...
  } finally {
    setIsDeleting(null);
  }
}

// No JSX
<button 
  disabled={isDeleting === t.id}
  onClick={() => deleteOne(t.id)}
>
  {isDeleting === t.id ? <Spinner size={15} /> : <Trash2 size={15} />}
</button>
```

---

## 🎯 Priorização

### Matriz de Prioridade

| Prioridade | Issue | Impacto | Esforço |
|------------|-------|---------|---------|
| 🔴 Crítica | #10 Criptografia do banco | Segurança de dados financeiros | Alto |
| 🔴 Alta | #6 CONTRIBUTING.md | Onboarding de contribuidores | Baixo |
| 🔴 Alta | #7 CODE_OF_CONDUCT.md | Inclusividade open source | Baixo |
| 🟡 Média | #1 Vazamento de estado | UX do usuário | Baixo |
| 🟡 Média | #2 Validação de valores | Prevenção de bugs | Baixo |
| 🟡 Média | #14 Tratamento de erros | UX e segurança | Médio |
| 🟡 Média | #16 CI multiplataforma | Qualidade do release | Médio |
| 🟢 Baixa | #3 SQL Injection OFX | Segurança (baixo risco) | Baixo |
| 🟢 Baixa | #4 Race condition | Estabilidade | Médio |
| 🟢 Baixa | #5 Porta hardcoded | DX | Baixo |
| 🟢 Baixa | #12 Duplicação de lógica | Manutenibilidade | Médio |
| 🟢 Baixa | #15 Demo data hardcoded | Clareza do código | Baixo |
| 🟢 Baixa | #20 Loading feedback | Polimento UX | Baixo |

---

## 📋 Checklist de Implementação

### Documentação (Semana 1)
- [ ] #6 Criar CONTRIBUTING.md
- [ ] #7 Criar CODE_OF_CONDUCT.md
- [ ] #8 Criar .env.example
- [ ] #9 Corrigir links do README
- [ ] Adicionar badges no README (build, license, version)
- [ ] Criar .github/ISSUE_TEMPLATE/bug_report.md
- [ ] Criar .github/ISSUE_TEMPLATE/feature_request.md
- [ ] Criar .github/PULL_REQUEST_TEMPLATE.md

### Segurança (Semanas 2-4)
- [ ] #10 Implementar SQLCipher
- [ ] #10 Integrar Windows Credential Manager
- [ ] #10 Documentar backup criptografado
- [ ] #11 Refinar CSP

### Bugs (Semana 2)
- [ ] #1 Fix vazamento de estado
- [ ] #2 Adicionar validação de limites
- [ ] #3 Sanitizar parser OFX
- [ ] #14 Tratamento de erros no frontend

### Infraestrutura (Semana 3)
- [ ] #16 CI multiplataforma
- [ ] #17 Changelog automático no release
- [ ] #18 Adicionar .gitattributes
- [ ] Configurar Codecov para coverage

### UX/UI (Semana 4)
- [ ] #19 Adicionar aria-labels em emojis
- [ ] #20 Loading feedback em ações assíncronas
- [ ] #4 Refatorar mutex de sessões

### Refatoração (Contínuo)
- [ ] #12 Unificar/sincronizar lógica de formatação
- [ ] #13 Melhorar testes de migration
- [ ] #15 Mover demo data para arquivo separado

---

## 📈 Métricas de Sucesso

Após implementação:

1. **Contribuições:**
   - Aumentar PRs de externos em 50%
   - Reduzir tempo de onboarding de contribuidores

2. **Qualidade:**
   - Coverage de testes > 80%
   - Zero issues críticas de segurança

3. **UX:**
   - Reduzir reports de bugs de UX em 30%
   - Feedback visual em 100% das ações assíncronas

4. **Segurança:**
   - Banco de dados 100% criptografado
   - CSP sem `unsafe-inline`

---

## 📚 Recursos Úteis

- [Tauri Security Guidelines](https://tauri.app/v1/guides/security)
- [SQLCipher Documentation](https://www.zetetic.net/sqlcipher/)
- [Contributor Covenant](https://www.contributor-covenant.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)

---

**Última atualização:** 2026-07-03  
**Próxima revisão:** 2026-08-03