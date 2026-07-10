use serde::Deserialize;
use sqlx::{Row, SqlitePool};
use tauri::State;

use super::{bind_transaction_filter, TransactionFilter, TRANSACTION_FILTER_WHERE};
use crate::{application::state::AppState, domain::import::normalize_description, error::AppError};

/// A single exported row, already resolved to display strings.
struct ExportRow {
    id: String,
    date: String,
    description: String,
    account_name: String,
    account_kind: String,
    category: String,
    amount_in_cents: i64,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPdfFilter {
    start_month: String,
    end_month: String,
    source: String,
    account_id: Option<String>,
}

/// Wraps a field in double quotes (doubling any inner quotes) only when it contains the
/// delimiter, a quote, or a newline — per RFC 4180, unquoted fields don't need escaping.
fn csv_field(value: &str) -> String {
    if value.contains(';') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Formats integer cents as a Brazilian decimal string (e.g. -1234 -> "-12,34").
fn format_amount(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.abs();
    format!("{}{},{:02}", sign, abs / 100, abs % 100)
}

fn account_kind_label(kind: &str) -> &'static str {
    match kind {
        "credit_card" => "Cartão de crédito",
        "savings" => "Poupança",
        "cash" => "Dinheiro",
        _ => "Conta corrente",
    }
}

fn status_label(status: &str) -> &'static str {
    if status == "cleared" {
        "Confirmada"
    } else {
        "Pendente"
    }
}

/// Fetches every transaction matching `filter` (no pagination — an export wants the full set),
/// reusing the same `TRANSACTION_FILTER_WHERE`/`bind_transaction_filter` machinery as
/// `list_transactions_page` so the exported rows always match what the Transações screen shows.
async fn fetch_export_rows(
    db: &SqlitePool,
    filter: &TransactionFilter,
) -> Result<Vec<ExportRow>, AppError> {
    let search_like = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", normalize_description(s)));
    let sql = format!(
        "SELECT t.id,t.date,t.description,a.name account_name,a.kind account_kind,
         COALESCE(c.name,'Sem categoria') category,t.amount_cents,t.status
         FROM transactions t JOIN accounts a ON a.id=t.account_id
         LEFT JOIN categories c ON c.id=t.category_id
         WHERE {TRANSACTION_FILTER_WHERE}
         ORDER BY t.date DESC, t.id DESC"
    );
    let query = bind_transaction_filter(sqlx::query(&sql), filter, &search_like);
    let rows = query.fetch_all(db).await?;
    Ok(rows
        .into_iter()
        .map(|r| ExportRow {
            id: r.get("id"),
            date: r.get("date"),
            description: r.get("description"),
            account_name: r.get("account_name"),
            account_kind: r.get("account_kind"),
            category: r.get("category"),
            amount_in_cents: r.get("amount_cents"),
            status: r.get("status"),
        })
        .collect())
}

fn format_amount_dot(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn build_ofx(rows: &[ExportRow]) -> String {
    let mut out = String::from(
        "OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:UTF-8\r\nCHARSET:UTF-8\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n\r\n<OFX><BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>BRL<BANKTRANLIST>",
    );
    for row in rows {
        out.push_str("<STMTTRN>");
        out.push_str(&format!(
            "<TRNTYPE>{}<DTPOSTED>{}<TRNAMT>{}<FITID>{}<NAME>{}<MEMO>{}",
            if row.amount_in_cents >= 0 {
                "CREDIT"
            } else {
                "DEBIT"
            },
            row.date.replace('-', ""),
            format_amount_dot(row.amount_in_cents),
            xml_escape(&row.id),
            xml_escape(&row.description),
            xml_escape(&format!("{} - {}", row.account_name, row.category)),
        ));
        out.push_str("</STMTTRN>");
    }
    out.push_str("</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\r\n");
    out
}

fn pdf_hex_text(value: &str) -> String {
    let mut out = String::from("<FEFF");
    for unit in value.encode_utf16() {
        out.push_str(&format!("{:04X}", unit));
    }
    out.push('>');
    out
}

fn push_pdf_line(content: &mut String, x: i32, y: i32, size: i32, text: &str) {
    content.push_str(&format!(
        "BT /F1 {} Tf {} {} Td {} Tj ET\n",
        size,
        x,
        y,
        pdf_hex_text(text)
    ));
}

fn build_pdf(title: &str, lines: &[String]) -> Vec<u8> {
    let mut pages: Vec<String> = Vec::new();
    for chunk in lines.chunks(34) {
        let mut content = String::new();
        push_pdf_line(&mut content, 48, 790, 18, title);
        let mut y = 752;
        for line in chunk {
            push_pdf_line(&mut content, 48, y, 10, line);
            y -= 20;
        }
        pages.push(content);
    }
    if pages.is_empty() {
        let mut content = String::new();
        push_pdf_line(&mut content, 48, 790, 18, title);
        push_pdf_line(
            &mut content,
            48,
            752,
            10,
            "Nenhum dado encontrado para o filtro.",
        );
        pages.push(content);
    }

    let page_count = pages.len();
    let font_id = 3 + page_count * 2;
    let mut objects = Vec::new();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());
    let kids = (0..page_count)
        .map(|i| format!("{} 0 R", 3 + i * 2))
        .collect::<Vec<_>>()
        .join(" ");
    objects.push(format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        kids, page_count
    ));
    for (index, content) in pages.iter().enumerate() {
        let page_id = 3 + index * 2;
        let content_id = page_id + 1;
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {} 0 R >> >> /Contents {} 0 R >>",
            font_id, content_id
        ));
        objects.push(format!(
            "<< /Length {} >>\nstream\n{}endstream",
            content.len(),
            content
        ));
    }
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string());

    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
    }
    let xref_offset = pdf.len();
    pdf.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets {
        pdf.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer << /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objects.len() + 1,
            xref_offset
        )
        .as_bytes(),
    );
    pdf
}

fn build_transactions_pdf(rows: &[ExportRow]) -> Vec<u8> {
    let income: i64 = rows
        .iter()
        .filter(|r| r.amount_in_cents > 0)
        .map(|r| r.amount_in_cents)
        .sum();
    let expenses: i64 = rows
        .iter()
        .filter(|r| r.amount_in_cents < 0)
        .map(|r| -r.amount_in_cents)
        .sum();
    let mut lines = vec![
        format!("Transações exportadas: {}", rows.len()),
        format!("Receitas: R$ {}", format_amount(income)),
        format!("Despesas: R$ {}", format_amount(expenses)),
        format!("Saldo: R$ {}", format_amount(income - expenses)),
        String::new(),
        "Data | Descrição | Conta | Categoria | Valor".into(),
    ];
    for row in rows.iter().take(120) {
        lines.push(format!(
            "{} | {} | {} | {} | R$ {}",
            row.date,
            row.description,
            row.account_name,
            row.category,
            format_amount(row.amount_in_cents)
        ));
    }
    if rows.len() > 120 {
        lines.push(format!(
            "...mais {} transações no filtro.",
            rows.len() - 120
        ));
    }
    build_pdf("Relatório de transações", &lines)
}

fn build_financial_report_pdf(rows: &[ExportRow], filter: &ReportPdfFilter) -> Vec<u8> {
    let income: i64 = rows
        .iter()
        .filter(|r| r.amount_in_cents > 0)
        .map(|r| r.amount_in_cents)
        .sum();
    let expenses: i64 = rows
        .iter()
        .filter(|r| r.amount_in_cents < 0)
        .map(|r| -r.amount_in_cents)
        .sum();
    let mut by_category = std::collections::BTreeMap::<String, i64>::new();
    for row in rows.iter().filter(|r| r.amount_in_cents < 0) {
        *by_category.entry(row.category.clone()).or_default() += -row.amount_in_cents;
    }
    let mut categories: Vec<_> = by_category.into_iter().collect();
    categories.sort_by_key(|(_, amount)| -*amount);
    let source = match filter.source.as_str() {
        "bank" => "contas bancárias",
        "credit_card" => "cartões de crédito",
        _ => "todas as origens",
    };
    let mut lines = vec![
        format!("Período: {} a {}", filter.start_month, filter.end_month),
        format!("Origem: {}", source),
        format!("Lançamentos considerados: {}", rows.len()),
        format!("Receitas: R$ {}", format_amount(income)),
        format!("Despesas: R$ {}", format_amount(expenses)),
        format!("Economia: R$ {}", format_amount(income - expenses)),
        String::new(),
        "Maiores categorias de despesa".into(),
    ];
    for (category, amount) in categories.iter().take(12) {
        let share = if expenses > 0 {
            *amount as f64 / expenses as f64 * 100.0
        } else {
            0.0
        };
        lines.push(format!(
            "{} | R$ {} | {:.1}%",
            category,
            format_amount(*amount),
            share
        ));
    }
    lines.push(String::new());
    lines.push("Últimas transações".into());
    for row in rows.iter().take(40) {
        lines.push(format!(
            "{} | {} | {} | R$ {}",
            row.date,
            row.description,
            row.category,
            format_amount(row.amount_in_cents)
        ));
    }
    build_pdf("Relatório financeiro", &lines)
}

/// Builds the full CSV document (UTF-8 BOM + pt-BR header + semicolon-delimited rows with
/// decimal-comma amounts) so Excel pt-BR opens it correctly.
fn build_csv(rows: &[ExportRow]) -> String {
    // BOM keeps acentos legible when opened directly in Excel.
    let mut out = String::from("\u{feff}");
    out.push_str("data;descricao;conta;tipo_conta;categoria;valor;status\r\n");
    for row in rows {
        out.push_str(&format!(
            "{};{};{};{};{};{};{}\r\n",
            csv_field(&row.date),
            csv_field(&row.description),
            csv_field(&row.account_name),
            csv_field(account_kind_label(&row.account_kind)),
            csv_field(&row.category),
            csv_field(&format_amount(row.amount_in_cents)),
            csv_field(status_label(&row.status)),
        ));
    }
    out
}

#[tauri::command]
pub async fn export_transactions_csv(
    path: String,
    filter: TransactionFilter,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let rows = fetch_export_rows(&state.db, &filter).await?;
    let count = rows.len();
    std::fs::write(&path, build_csv(&rows))?;
    Ok(count)
}

#[tauri::command]
pub async fn export_transactions_ofx(
    path: String,
    filter: TransactionFilter,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let rows = fetch_export_rows(&state.db, &filter).await?;
    let count = rows.len();
    std::fs::write(&path, build_ofx(&rows))?;
    Ok(count)
}

#[tauri::command]
pub async fn export_transactions_pdf(
    path: String,
    filter: TransactionFilter,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let rows = fetch_export_rows(&state.db, &filter).await?;
    let count = rows.len();
    std::fs::write(&path, build_transactions_pdf(&rows))?;
    Ok(count)
}

#[tauri::command]
pub async fn export_financial_report_pdf(
    path: String,
    filter: ReportPdfFilter,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let transaction_filter = TransactionFilter {
        start_month: Some(filter.start_month.clone()),
        end_month: Some(filter.end_month.clone()),
        source: (filter.source != "all").then_some(filter.source.clone()),
        account_id: filter.account_id.clone(),
        ..Default::default()
    };
    let rows = fetch_export_rows(&state.db, &transaction_filter).await?;
    let count = rows.len();
    std::fs::write(&path, build_financial_report_pdf(&rows, &filter))?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    async fn seeded_pool() -> (tempfile::TempDir, SqlitePool) {
        let directory = tempfile::tempdir().unwrap();
        let pool = crate::infrastructure::database::connect(&directory.path().join("export.db"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO accounts(id,name,kind) VALUES('acc-bank','Conta Corrente','checking')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO accounts(id,name,kind) VALUES('acc-card','Cartão \"Ouro\"','credit_card')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO categories(id,name,kind,is_system) VALUES('cat-food','Alimentação;Bebidas','expense',0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,category_id,category_source,status)
             VALUES('t1','acc-bank','2026-06-01','Salário','SALARIO',780000,'fp1','cat-food','manual','cleared')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transactions(id,account_id,date,description,normalized_description,amount_cents,fingerprint,category_id,category_source,status)
             VALUES('t2','acc-card','2026-06-02','Restaurante \"bom\"\ncom quebra de linha','RESTAURANTE',-4590,'fp2',NULL,NULL,'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();
        (directory, pool)
    }

    #[tokio::test]
    async fn exports_csv_with_bom_semicolons_and_decimal_comma() {
        let (_directory, pool) = seeded_pool().await;
        let rows = fetch_export_rows(&pool, &TransactionFilter::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        let csv = build_csv(&rows);

        assert!(
            csv.starts_with('\u{feff}'),
            "csv should start with a UTF-8 BOM"
        );
        assert!(csv.contains("data;descricao;conta;tipo_conta;categoria;valor;status\r\n"));
        // Newest first (t2, then t1).
        assert!(csv.contains("\"Restaurante \"\"bom\"\"\ncom quebra de linha\";\"Cartão \"\"Ouro\"\"\";Cartão de crédito;Sem categoria;-45,90;Pendente\r\n"));
        assert!(csv.contains(
            "Salário;Conta Corrente;Conta corrente;\"Alimentação;Bebidas\";7800,00;Confirmada\r\n"
        ));
    }

    #[tokio::test]
    async fn export_to_temp_file_writes_expected_content() {
        let (directory, pool) = seeded_pool().await;
        let path = directory.path().join("transacoes.csv");

        let rows = fetch_export_rows(&pool, &TransactionFilter::default())
            .await
            .unwrap();
        std::fs::write(&path, build_csv(&rows)).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8(bytes).unwrap();
        assert!(content.starts_with('\u{feff}'));
        // 2 data rows terminated by \r\n, plus the header line.
        assert_eq!(content.matches("\r\n").count(), 3);
        assert!(content.contains("-45,90"));
    }

    #[tokio::test]
    async fn export_respects_filter() {
        let (_directory, pool) = seeded_pool().await;
        let filter = TransactionFilter {
            account_id: Some("acc-bank".into()),
            ..Default::default()
        };
        let rows = fetch_export_rows(&pool, &filter).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].account_name, "Conta Corrente");

        let advanced_filter = TransactionFilter {
            status: Some("pending".into()),
            movement_type: Some("expense".into()),
            min_abs_amount_in_cents: Some(4000),
            max_abs_amount_in_cents: Some(5000),
            start_date: Some("2026-06-02".into()),
            end_date: Some("2026-06-02".into()),
            ..Default::default()
        };
        let advanced_rows = fetch_export_rows(&pool, &advanced_filter).await.unwrap();
        assert_eq!(advanced_rows.len(), 1);
        assert_eq!(advanced_rows[0].account_name, "Cartão \"Ouro\"");
    }
}
