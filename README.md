<div align="center">
  <img src="src-tauri/icons/128x128.png" width="128" alt="Lúmen Logo" style="margin-bottom: 20px;" />

  <h1>Lúmen</h1>

  <p>
    <b>Iluminando suas finanças, respeitando sua privacidade.</b>
  </p>

  <p>
    Um gerenciador financeiro desktop moderno, local-first e 100% open source.
    Sem nuvem, sem assinatura e sem coleta de dados.
  </p>

  <p>
    <a href="#-o-que-é-o-lúmen">O que é</a> •
    <a href="#-por-que-o-lúmen">Por que usar</a> •
    <a href="#-funcionalidades">Funcionalidades</a> •
    <a href="#-tecnologias">Tecnologias</a> •
    <a href="#-como-executar">Como executar</a>
  </p>
</div>

---

## 💡 O que é o Lúmen?

O **Lúmen** é um gerenciador financeiro desktop criado para ajudar você a entender melhor sua vida financeira sem abrir mão da privacidade.

Diferente de muitos aplicativos financeiros baseados em nuvem, o Lúmen foi pensado com uma abordagem **local-first**: seus dados ficam armazenados e processados exclusivamente na sua própria máquina.

Sem login obrigatório.
Sem servidores intermediando seus extratos.
Sem coleta silenciosa de informações financeiras.

A proposta é simples: oferecer uma experiência moderna, rápida e elegante para organizar contas, acompanhar gastos, importar extratos e visualizar sua saúde financeira com clareza.

---

## ❓ Por que o Lúmen?

### 🔒 Privacidade de verdade

Seus dados financeiros são sensíveis. Por isso, o Lúmen foi projetado para funcionar localmente, mantendo o banco de dados no seu próprio computador.

Nada de enviar extratos para servidores externos.
Nada de sincronização forçada em nuvem.
Nada de vender ou analisar seus dados.

Você mantém o controle.

### 🌱 100% open source

O Lúmen é um projeto **100% open source**.

Isso significa que qualquer pessoa pode estudar o código, auditar o funcionamento, sugerir melhorias, abrir issues ou contribuir com novas funcionalidades.

Transparência é parte central do projeto.

### ⚡ Experiência desktop moderna

Construído com **Tauri**, **Rust**, **React** e **TypeScript**, o Lúmen combina uma interface moderna com o desempenho de uma aplicação nativa.

O objetivo é entregar uma experiência leve, rápida e agradável, sem depender de navegadores pesados ou serviços externos.

### 🧠 Organização inteligente

O Lúmen ajuda a reduzir o trabalho manual ao importar extratos, revisar transações e categorizar gastos de forma cada vez mais prática.

A ideia é que, com o tempo, o app ajude você a entender melhor seus hábitos financeiros e tomar decisões com mais clareza.

---

## ✨ Funcionalidades

### 📊 Dashboard financeiro

Visualize rapidamente a saúde financeira do mês:

* entradas e saídas consolidadas;
* comparação entre renda planejada e movimentações reais;
* visão geral das transações;
* indicadores para entender melhor seus gastos.

### 📥 Importação de extratos

Importe arquivos financeiros diretamente no aplicativo:

* suporte a arquivos `.csv`;
* suporte a arquivos `.ofx`;
* suporte a PDFs textuais de extratos do Sicoob;
* prévia antes de confirmar a importação;
* commit atômico das transações;
* deduplicação para evitar lançamentos repetidos.

### 🧾 Lista de transações

Acompanhe suas movimentações em uma interface pesquisável e organizada:

* busca por descrição;
* visualização de valores em centavos para maior precisão;
* distinção entre receitas, despesas e transferências;
* estrutura preparada para evolução de filtros, edição e organização avançada.

### 🧠 Categorização automática

O Lúmen conta com uma base local de categorias brasileiras e um mecanismo de categorização por regras.

A proposta é facilitar a organização recorrente de gastos, mantendo tudo processado localmente.

### 👤 Onboarding local

Ao iniciar o app, você pode configurar informações básicas para personalizar a experiência:

* perfil local;
* renda de referência;
* primeira conta;
* edição posterior das informações.

### 🛡️ Arquitetura focada em segurança

O frontend não acessa o banco de dados diretamente. A comunicação com os dados locais passa pela camada nativa da aplicação, reduzindo a exposição indevida de informações sensíveis.

> **Nota importante:** o projeto ainda está em evolução. Antes do uso com dados financeiros reais, a integração com criptografia local, como SQLCipher e proteção via Windows Credential Manager/DPAPI, é um marco importante do roadmap.

---

## 🛠 Tecnologias

O Lúmen utiliza um stack moderno com foco em desempenho, segurança e manutenibilidade:

* **Tauri 2** — aplicação desktop leve e multiplataforma;
* **Rust** — backend nativo seguro e performático;
* **React** — construção da interface;
* **TypeScript** — tipagem estática no frontend;
* **SQLite** — banco de dados local;
* **Vite** — ambiente de desenvolvimento rápido;
* **CSS Vanilla** — estilização com tokens para tema claro e escuro.

---

## 🎨 Identidade visual

A interface do Lúmen foi pensada para transmitir clareza, confiança e liberdade financeira.

A paleta principal utiliza tons de verde esmeralda:

* **Tema claro:** `#176148`
* **Tema escuro:** `#3ea57e`

O design busca uma experiência limpa, moderna e confortável, com suporte nativo a tema claro e escuro por meio de variáveis CSS.

---

## 🚀 Como executar

### Pré-requisitos

Antes de começar, certifique-se de ter instalado:

* [Node.js](https://nodejs.org/)
* [Rust](https://www.rust-lang.org/tools/install)
* Dependências nativas do [Tauri](https://tauri.app/)

No Windows, também é necessário ter o ambiente MSVC configurado, incluindo o Visual Studio Build Tools com suporte a desenvolvimento desktop em C++.

---

### Instalação

Clone o repositório:

```bash
git clone https://github.com/seu-usuario/lumen.git
cd lumen
```

Instale as dependências do frontend:

```bash
npm install
```

Execute a aplicação desktop em modo de desenvolvimento:

```bash
npm run tauri dev
```

---

## 🧪 Testes

Execute os testes do frontend:

```bash
npm test
```

Gere o build web:

```bash
npm run build
```

Execute os testes Rust:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 📦 Build

Para gerar uma versão desktop da aplicação:

```bash
npm run tauri build
```

O instalador será gerado na pasta de saída do Tauri.

---

## 🗺️ Roadmap

Alguns próximos marcos planejados para o projeto:

* criptografia do banco local;
* integração com Windows Credential Manager/DPAPI;
* CRUD completo de transações;
* regras avançadas de categorização;
* suporte aprimorado a cartões de crédito;
* orçamentos mensais;
* metas financeiras;
* backup local;
* instalador assinado;
* melhorias de acessibilidade;
* refinamento visual da interface.

---

## 🤝 Como contribuir

Contribuições são muito bem-vindas.

O Lúmen é um projeto **100% open source** e qualquer ajuda é válida: correção de bugs, sugestões de interface, melhorias de documentação, testes, novas funcionalidades ou revisão de código.

Para contribuir:

1. Faça um fork do projeto.
2. Crie uma branch para sua alteração:

```bash
git checkout -b feature/minha-melhoria
```

3. Faça o commit das alterações:

```bash
git commit -m "Adiciona minha melhoria"
```

4. Envie para o seu fork:

```bash
git push origin feature/minha-melhoria
```

5. Abra um Pull Request.

---

## 📄 Licença

Este projeto é open source.

Adicione aqui a licença escolhida para o projeto, por exemplo:

```md
MIT License
```

---

<div align="center">
  <p>
    Feito com cuidado para quem valoriza estética, autonomia e privacidade.
  </p>
</div>
