# ADR 0001 — Arquitetura local-first com Tauri

## Status

Aceita.

## Decisão

React cuida somente da apresentação e chama comandos Tauri. Rust concentra importação,
regras e persistência SQLite. O frontend nunca acessa diretamente o banco.

## Consequências

O domínio pode ser testado sem interface. Capacidades do Tauri limitam o acesso ao
seletor de arquivos. A distribuição requer WebView2 e a toolchain Rust/MSVC.
