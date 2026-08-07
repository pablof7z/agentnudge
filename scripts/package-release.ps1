param(
    [Parameter(Mandatory = $true)]
    [string]$Target,

    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [string]$Binary
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Binary -PathType Leaf)) {
    throw "Binary does not exist: $Binary"
}
if ($Version -notmatch '^[0-9A-Za-z.+-]+$') {
    throw "Invalid version: $Version"
}

$outputPath = [IO.Path]::GetFullPath($OutputDir)
$package = "agentnudge-$Target"
$archive = Join-Path $outputPath "$package.zip"
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "agentnudge-package-$([guid]::NewGuid().ToString('N'))"
$packageDirectory = Join-Path $temporaryDirectory $package

New-Item -ItemType Directory -Force -Path $outputPath, $packageDirectory | Out-Null

try {
    Copy-Item -LiteralPath $Binary -Destination (Join-Path $packageDirectory "agentnudge.exe")
    Copy-Item -LiteralPath "README.md", "LICENSE" -Destination $packageDirectory
    Set-Content -LiteralPath (Join-Path $packageDirectory "VERSION") -Value $Version -NoNewline
    Compress-Archive -LiteralPath $packageDirectory -DestinationPath $archive -Force
    Write-Output $archive
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
