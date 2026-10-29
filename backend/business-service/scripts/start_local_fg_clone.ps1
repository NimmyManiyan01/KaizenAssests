$ErrorActionPreference = 'Stop'
$fgServiceRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $fgServiceRoot
$fgExpectedDatabase = 'kaizenassests_test_fg_clone_202610290741304887b0'
$fgCurrent = $null
try {
    $fgCurrent = Invoke-RestMethod -Uri 'http://localhost:8000/api/local/fg-clone-status' -TimeoutSec 3
} catch { }
if ($fgCurrent -and $fgCurrent.database -eq $fgExpectedDatabase -and $fgCurrent.revision -eq '20261037_fg_section_numbering') {
    Write-Output "Verified local clone backend is already running: $fgExpectedDatabase"
    exit 0
}
$fgOtherBackend = $null
try { $fgOtherBackend = Invoke-RestMethod -Uri 'http://localhost:8000/health' -TimeoutSec 3 } catch { }
if ($fgOtherBackend) {
    throw 'Port 8000 is occupied by another backend. Verify its ownership before stopping it; this launcher will not replace it automatically.'
}
& "$fgServiceRoot/.venv/Scripts/python.exe" scripts/verify_fg_database_clone.py serve --manifest backups/fg-safe-clone-202610290741304887b0/manifest.json --port 8000 --allow-local-port-8000
exit $LASTEXITCODE
