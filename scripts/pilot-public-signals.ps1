param(
    [string]$Repository = "filipeclacerda/lumen",
    [ValidateRange(1, 100)]
    [int]$ReleaseCount = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$headers = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "lumen-pilot-signals"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$repositoryUri = "https://api.github.com/repos/$Repository"
$repo = Invoke-RestMethod -Uri $repositoryUri -Headers $headers
$releaseResponse = Invoke-RestMethod `
    -Uri "$repositoryUri/releases?per_page=$ReleaseCount" `
    -Headers $headers
$releases = @($releaseResponse | ForEach-Object { $_ })

$packagePattern = "\.(AppImage|deb|dmg|msi)$|\.app\.tar\.gz$|setup\.exe$"
$releaseRows = foreach ($release in $releases) {
    $packageAssets = @(
        $release.assets | Where-Object {
            $_.name -ne "latest.json" -and
            -not $_.name.EndsWith(".sig") -and
            $_.name -match $packagePattern
        }
    )

    [pscustomobject]@{
        tag = $release.tag_name
        publishedAt = $release.published_at
        packageAssets = $packageAssets.Count
        packageDownloadEvents = [int]((
            $packageAssets |
                Measure-Object -Property download_count -Sum
        ).Sum ?? 0)
    }
}

$result = [pscustomobject]@{
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    repository = $Repository
    releasesAnalyzed = $releaseRows.Count
    stars = [int]$repo.stargazers_count
    forks = [int]$repo.forks_count
    packageDownloadEvents = [int]((
        $releaseRows |
            Measure-Object -Property packageDownloadEvents -Sum
    ).Sum ?? 0)
    releases = $releaseRows
    caveat = "Downloads de ativos nao representam pessoas unicas, instalacoes concluidas, primeiro valor ou retencao."
}

$result | ConvertTo-Json -Depth 5
