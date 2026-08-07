param(
    [string]$InstallDir = $(if ($env:AGENTNUDGE_INSTALL_DIR) { $env:AGENTNUDGE_INSTALL_DIR } else { Join-Path $HOME ".local\bin" }),
    [string]$Version = $env:AGENTNUDGE_VERSION,
    [string]$ReleaseUrl = $env:AGENTNUDGE_RELEASE_URL
)

$ErrorActionPreference = "Stop"
$repository = if ($env:AGENTNUDGE_REPOSITORY) { $env:AGENTNUDGE_REPOSITORY } else { "pablof7z/agentnudge" }

if (-not $ReleaseUrl) {
    if ($Version) {
        if (-not $Version.StartsWith("v")) {
            $Version = "v$Version"
        }
        $ReleaseUrl = "https://github.com/$repository/releases/download/$Version"
    }
    else {
        $ReleaseUrl = "https://github.com/$repository/releases/latest/download"
    }
}

$architecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
if ($architecture -ne "X64") {
    throw "AgentNudge currently publishes a Windows installer for x64 only; detected $architecture."
}

$target = "x86_64-pc-windows-msvc"
$archiveName = "agentnudge-$target.zip"
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "agentnudge-install-$([guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $temporaryDirectory $archiveName
$checksumsPath = Join-Path $temporaryDirectory "SHA256SUMS"

New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null

function Get-ReleaseFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    if ($ReleaseUrl -match '^https?://') {
        Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseUrl/$Name" -OutFile $Destination
        return
    }
    if (Test-Path -LiteralPath $ReleaseUrl -PathType Container) {
        Copy-Item -LiteralPath (Join-Path $ReleaseUrl $Name) -Destination $Destination
        return
    }
    throw "ReleaseUrl must be an HTTP(S) URL or a local directory; received $ReleaseUrl."
}

try {
    Get-ReleaseFile -Name $archiveName -Destination $archivePath
    Get-ReleaseFile -Name "SHA256SUMS" -Destination $checksumsPath

    $escapedArchive = [regex]::Escape($archiveName)
    $checksumLine = Get-Content -LiteralPath $checksumsPath |
        Where-Object { $_ -match "^([0-9a-fA-F]{64})\s+\*?$escapedArchive$" } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "SHA256SUMS does not contain $archiveName."
    }

    $expected = [regex]::Match($checksumLine, '^([0-9a-fA-F]{64})').Groups[1].Value.ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Checksum verification failed for $archiveName."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $temporaryDirectory -Force
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $installedBinary = Join-Path $InstallDir "agentnudge.exe"
    Copy-Item -LiteralPath (Join-Path $temporaryDirectory "agentnudge-$target\agentnudge.exe") -Destination $installedBinary -Force

    $installedVersion = & $installedBinary --version
    Write-Output "Installed $installedVersion at $installedBinary"
    if (($env:PATH -split ';') -notcontains $InstallDir) {
        Write-Output "Add $InstallDir to PATH to run agentnudge from any directory."
    }
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
