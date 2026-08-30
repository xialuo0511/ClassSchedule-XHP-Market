[CmdletBinding()]
param([string]$OutputPath = (Join-Path $PSScriptRoot 'dist\gdou-course-import-1.0.0.xhp'))
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
$temporary = Join-Path (Split-Path -Parent $target) (([guid]::NewGuid().ToString()) + '.zip')
Compress-Archive -LiteralPath @((Join-Path $PSScriptRoot 'plugin.json'), (Join-Path $PSScriptRoot 'main.js')) -DestinationPath $temporary -CompressionLevel Optimal
Move-Item -LiteralPath $temporary -Destination $target -Force
Write-Host "Built XHP package: $target"
