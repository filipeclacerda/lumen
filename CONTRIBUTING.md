# Contribuindo com o Lumen

Obrigado por seu interesse em contribuir com o Lumen! Este projeto é 100% open source e depende de contribuidores como você para crescer e melhorar.

## 📋 Índice

- [Código de Conduta](#código-de-conduta)
- [Primeiros Passos](#primeiros-passos)
- [Ambiente de Desenvolvimento](#ambiente-de-desenvolvimento)
- [Padrões de Código](#padrões-de-código)
- [Como Contribuir](#como-contribuir)
- [Pull Requests](#pull-requests)
- [Dúvidas?](#dúvidas)

---

## 🤝 Código de Conduta

Este projeto segue o [Contributor Covenant](https://www.contributor-covenant.org/). Por favor, leia nosso [Código de Conduta](CODE_OF_CONDUCT.md) antes de começar.

---

## 🚀 Primeiros Passos

### 1. Fork o Projeto

Faça um fork do repositório clicando em "Fork" no GitHub.

### 2. Clone o Repositório

```bash
git clone https://github.com/SEU_USUARIO/lumen.git
cd lumen
```

### 3. Adicione o Remote Upstream

```bash
git remote add upstream https://github.com/filipeclacerda/lumen.git
```

### 4. Instale as Dependências

```bash
# Frontend
npm install

# Rust (se ainda não tiver)
# Acesse https://rustup.rs/ para instalar
```

---

## 💻 Ambiente de Desenvolvimento

### Pré-requisitos

- [Node.js 22+](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Git](https://git-scm.com/)

**Windows:**

- Visual Studio Build Tools com suporte a C++
- WebView2 (geralmente já instalado no Windows 10/11)

**Linux:**

- Veja os pré-requisitos em [Tauri Linux Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites#linux)

**macOS:**

- Xcode Command Line Tools

### Rodando em Desenvolvimento

```bash
# Instale as dependências
npm install

# Rode o app em modo de desenvolvimento
npm run tauri dev
```

### Rodando Testes

```bash
# Testes do frontend
npm test

# Testes do backend Rust
cargo test --manifest-path src-tauri/Cargo.toml

# Build do frontend
npm run build
```

### Gerando Build

```bash
# Build da aplicação desktop
npm run tauri build
```

---

## 📝 Padrões de Código

### TypeScript/React

- Use **ESLint** para linting: `npm run lint`
- Siga o estilo existente nos arquivos
- Use tipagem TypeScript sempre que possível
- Nomeie componentes em PascalCase
- Nomeie funções e variáveis em camelCase

```typescript
// ✅ Bom
export function Dashboard() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  // ...
}

// ❌ Evite
export function dashboard() {
  const [month, setmonth] = useState(...);
}
```

### Rust

- Siga o [Rust Style Guide](https://github.com/rust-lang/rust/tree/master/src/doc/style-guide)
- Use `cargo fmt` antes de commitar
- Use `cargo clippy` para linting

```bash
# Formatar código
cargo fmt

# Rodar clippy
cargo clippy --manifest-path src-tauri/Cargo.toml
```

```rust
// ✅ Bom
pub fn parse_brl(value: &str) -> Result<i64, AppError> {
    let clean = value.trim().replace("R$", "").replace(' ', "");
    // ...
}

// ❌ Evite
pub fn ParseBRL(Value: &str) -> Result<i64, AppError> {
    // ...
}
```

### Commits

Siga o [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: adiciona importação de PDF do Sicoob
fix: corrige vazamento de estado na lista de transações
docs: atualiza README com instruções de instalação
style: formata código TypeScript
refactor: extrai lógica de parse para módulo separado
test: adiciona testes para parser de OFX
chore: atualiza dependências
```

---

## 🛠️ Como Contribuir

### Encontrando Issues

- Veja [issues abertas](https://github.com/filipeclacerda/lumen/issues)
- Procure por labels como `good first issue` para começar
- Issues com `help wanted` precisam de contribuidores

### Tipos de Contribuição

1. **Bug Fixes:** Corrija bugs reportados nas issues
2. **Novas Funcionalidades:** Implemente features discutidas nas issues
3. **Documentação:** Melhore README, guias, comentários
4. **Testes:** Adicione testes para cobrir mais casos
5. **Refatoração:** Melhore código existente sem mudar comportamento
6. **Performance:** Otimize código lento ou ineficiente

### Branches

Crie branches descritivas:

```bash
# Para novas features
git checkout -b feature/importacao-pdf-sicoob

# Para correções de bugs
git checkout -b fix/vazamento-estado-transactions

# Para documentação
git checkout -b docs/melhora-readme
```

---

## 🔀 Pull Requests

### Antes de Enviar

1. **Sincronize com o upstream:**

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Rode os testes:**

   ```bash
   npm test
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

3. **Rode o linter:**

   ```bash
   npm run lint
   cargo clippy --manifest-path src-tauri/Cargo.toml
   ```

4. **Teste manualmente:**
   ```bash
   npm run tauri dev
   ```

### Enviando o PR

1. Faça commit das mudanças:

   ```bash
   git commit -m "feat: adiciona funcionalidade X"
   ```

2. Push para seu fork:

   ```bash
   git push origin feature/minha-feature
   ```

3. Abra um Pull Request no GitHub

### Template de PR

Por favor, use nosso template de PR e inclua:

- **Descrição clara** do que foi feito
- **Motivação** para a mudança
- **Como testar** a funcionalidade
- **Screenshots** (se aplicável)
- **Issues relacionadas** (ex: `Fixes #123`)

### Processo de Review

1. Um mantenedor irá revisar seu código
2. Feedback será dado como comentários no PR
3. Faça as mudanças solicitadas
4. Após aprovação, seu PR será mergeado

---

## 📚 Recursos Úteis

- [Documentação do Tauri](https://tauri.app/)
- [The Rust Programming Language](https://doc.rust-lang.org/book/)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

## ❓ Dúvidas?

- Abra uma [discussion](https://github.com/filipeclacerda/lumen/discussions)
- Entre em contato via email (veja no perfil do mantenedor)
- Participe das discussions existentes

---

## 🙏 Agradecimentos

Obrigado por contribuir com o Lumen! Cada contribuição ajuda a tornar as finanças mais privadas e acessíveis para todos.

<div align="center">
  <p>Feito com 💚 pela comunidade open source</p>
</div>
