param(
    [switch]$Bundle
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-PilotStep {
    param(
        [Parameter(Mandatory)]
        [string]$Label,
        [Parameter(Mandatory)]
        [scriptblock]$Action
    )

    Write-Host "`n==> $Label"
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Label falhou com codigo $LASTEXITCODE."
    }
}

Invoke-PilotStep "Frontend: lint, formato, testes e build" {
    npm run check
}
Invoke-PilotStep "Rust: formato" {
    cargo fmt --manifest-path src-tauri/Cargo.toml --check
}
Invoke-PilotStep "Rust: clippy" {
    cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
}
Invoke-PilotStep "Rust: testes" {
    cargo test --manifest-path src-tauri/Cargo.toml
}

if ($Bundle) {
    if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
        Write-Warning "TAURI_SIGNING_PRIVATE_KEY ausente. O bundle local sera gerado sem assinatura e nao deve ser publicado como release oficial."
        Invoke-PilotStep "Tauri: build empacotada local sem assinatura" {
            npm run tauri -- build --no-sign
        }
    } else {
        Invoke-PilotStep "Tauri: build empacotada assinada" {
            npm run tauri -- build
        }
    }
} else {
    Invoke-PilotStep "Tauri: build debug sem bundle" {
        npm run tauri -- build --debug --no-bundle
    }
}

Write-Host "`nPreflight concluido. Execute e registre separadamente o smoke manual descrito em docs/pilot/smoke-build-empacotada.md."
