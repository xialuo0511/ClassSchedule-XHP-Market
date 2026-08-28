[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot 'dist\huashang-course-import-1.0.2.xhp'
}

$manifestPath = Join-Path $PSScriptRoot 'plugin.json'
$scriptPath = Join-Path $PSScriptRoot 'main.js'

foreach ($requiredFile in @($manifestPath, $scriptPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Missing required file: $requiredFile"
    }
}

if ([System.IO.Path]::GetExtension($OutputPath) -ne '.xhp') {
    throw 'OutputPath must end with .xhp'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.protocolVersion -ne 3) {
    throw 'plugin.json must use package protocolVersion 3'
}
if (@($manifest.capabilities) -notcontains 'course_import') {
    throw 'plugin.json must declare course_import'
}
if ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8))) {
    throw 'main.js must not be empty'
}

$rootBytes = (Get-Item -LiteralPath $manifestPath).Length +
    (Get-Item -LiteralPath $scriptPath).Length
if ($rootBytes -gt 2MB) {
    throw 'Uncompressed root files exceed the 2 MiB XHP limit'
}

$absoluteOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $absoluteOutput
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$temporaryZip = Join-Path $outputDirectory 'huashang-course-import.tmp.zip'
Remove-Item -LiteralPath $temporaryZip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $absoluteOutput -Force -ErrorAction SilentlyContinue

try {
    Compress-Archive `
        -LiteralPath @($manifestPath, $scriptPath) `
        -DestinationPath $temporaryZip `
        -CompressionLevel Optimal

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($temporaryZip)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
        $expected = @('main.js', 'plugin.json')
        $differences = @(Compare-Object -ReferenceObject $expected -DifferenceObject $entries)
        if ($differences.Count -ne 0) {
            throw "Unexpected ZIP entries: $($entries -join ', ')"
        }
    }
    finally {
        $archive.Dispose()
    }

    Move-Item -LiteralPath $temporaryZip -Destination $absoluteOutput
    Write-Host "Built XHP package: $absoluteOutput"
}
finally {
    Remove-Item -LiteralPath $temporaryZip -Force -ErrorAction SilentlyContinue
}
