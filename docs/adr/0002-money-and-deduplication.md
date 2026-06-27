# ADR 0002 — Dinheiro e deduplicação

Valores são inteiros em centavos e datas são ISO `YYYY-MM-DD`. O identificador externo
é a primeira chave de deduplicação. Na ausência dele, usa-se SHA-256 sobre conta, data,
valor e descrição normalizada. Importações são persistidas em uma única transação.
