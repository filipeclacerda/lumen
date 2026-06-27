use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Dados inválidos: {0}")] Validation(String),
    #[error("Não foi possível acessar os dados locais")]
    Database(#[from] sqlx::Error),
    #[error("Não foi possível atualizar a estrutura dos dados")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("Não foi possível ler o arquivo")]
    Io(#[from] std::io::Error),
    #[error("Não foi possível extrair o texto do PDF")]
    Pdf(String),
    #[error("Formato de arquivo não reconhecido")]
    UnsupportedFormat,
    #[error("Sessão de importação expirada")]
    SessionExpired,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SafeError { code: &'static str, message: String, recoverable: bool }

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: serde::Serializer {
        let code = match self {
            Self::Validation(_) => "VALIDATION", Self::Database(_) | Self::Migration(_) => "DATABASE",
            Self::Io(_) => "FILE_IO", Self::Pdf(_) => "PDF_EXTRACTION",
            Self::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            Self::SessionExpired => "SESSION_EXPIRED",
        };
        SafeError { code, message: self.to_string(), recoverable: true }.serialize(serializer)
    }
}
