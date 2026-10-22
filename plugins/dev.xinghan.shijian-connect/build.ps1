[CmdletBinding()]
param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot 'dist/shijian-connect-1.0.0.xhp'
}
if ([System.IO.Path]::GetExtension($OutputPath).ToLowerInvariant() -ne '.xhp') { throw 'OutputPath must end with .xhp' }
$sources = @{}
foreach ($name in @('plugin.json', 'main.js')) { $sources[$name] = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name)) }
$manifest = [System.Text.Encoding]::UTF8.GetString($sources['plugin.json']) | ConvertFrom-Json
if ($manifest.id -ne 'dev.xinghan.shijian-connect' -or $manifest.minAppVersion -ne '1.5.0' -or $manifest.protocolVersion -ne 3) {
    throw 'Unexpected plugin id, minimum host version or protocol'
}
foreach ($capability in @('web_ui', 'semester_export', 'lan_connect')) {
    if (@($manifest.capabilities) -notcontains $capability) { throw "Missing capability: $capability" }
}
if ($sources['plugin.json'].Length + $sources['main.js'].Length -gt 2MB -or $sources['main.js'].Length -eq 0) { throw 'Invalid package size' }
$destination = [System.IO.Path]::GetFullPath($OutputPath)
$directory = [System.IO.Path]::GetDirectoryName($destination)
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$temporary = Join-Path $directory ([System.Guid]::NewGuid().ToString('N') + '.tmp')
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    $archive = [System.IO.Compression.ZipFile]::Open($temporary, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in @('plugin.json', 'main.js')) {
            $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [System.DateTimeOffset]::new(2026, 10, 22, 0, 0, 0, [System.TimeSpan]::Zero)
            $stream = $entry.Open()
            try { $stream.Write($sources[$name], 0, $sources[$name].Length) } finally { $stream.Dispose() }
        }
    } finally { $archive.Dispose() }
    $verify = [System.IO.Compression.ZipFile]::OpenRead($temporary)
    try {
        if ($verify.Entries.Count -ne 2) { throw 'Unexpected ZIP entries' }
        foreach ($entry in $verify.Entries) {
            if (-not $sources.ContainsKey($entry.FullName)) { throw 'Unexpected ZIP entry name' }
            $input = $entry.Open(); $buffer = [System.IO.MemoryStream]::new()
            try { $input.CopyTo($buffer); $bytes = $buffer.ToArray() } finally { $input.Dispose(); $buffer.Dispose() }
            if ([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($sources[$entry.FullName])) { throw 'ZIP readback mismatch' }
        }
    } finally { $verify.Dispose() }
    # Same-volume replacement; preserve an existing package until validation completes.
    if ([System.IO.File]::Exists($destination)) { [System.IO.File]::Replace($temporary, $destination, [NullString]::Value) }
    else { [System.IO.File]::Move($temporary, $destination) }
    Write-Output "Built: $destination"
    Write-Output "SHA256: $((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant())"
} finally {
    if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
}
