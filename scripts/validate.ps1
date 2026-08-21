param(
    [string]$DotnetPath = "dotnet",
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE."
    }
}

if (-not $SkipNpmInstall) {
    Invoke-Checked npm ci
}

Invoke-Checked npm run check
Invoke-Checked npm test
Invoke-Checked npm run build
Invoke-Checked npm run validate:framework
Invoke-Checked npm run validate:source-provenance

Invoke-Checked $DotnetPath msbuild `
    "src\legacy-trade-reconciliation\LegacyTradeReconciliation.sln" `
    "/t:Restore,Build" `
    "/p:Configuration=Release" `
    "/v:minimal"

Invoke-Checked $DotnetPath run `
    "--project" `
    "validation\LegacyCharacterizationNet8\LegacyCharacterizationNet8.csproj" `
    "--configuration" `
    "Release"

Invoke-Checked $DotnetPath test `
    "src\canonical-modernized\TradeRecon.sln" `
    "--configuration" `
    "Release"

Invoke-Checked node evaluator\bin\evaluate.js fixture-hashes
Invoke-Checked npm --workspace dashboard run build:singlefile

$freezePath = Join-Path $env:TEMP "spec-handoff-freeze-readiness.json"
try {
    & node benchmark\bin\benchmark.js freeze --out $freezePath
    if ($LASTEXITCODE -ne 2) {
        throw "Freeze readiness must exit 2 before real specs and approvals; received $LASTEXITCODE."
    }
    $freeze = Get-Content -Raw $freezePath | ConvertFrom-Json
    if ($freeze.ready -ne $false -or $freeze.status -ne "not-evaluated") {
        throw "Pre-measurement freeze readiness did not fail closed."
    }
}
finally {
    if (Test-Path $freezePath) {
        Remove-Item -LiteralPath $freezePath -Force
    }
}

Write-Host "All Spec Handoff Experiment validations passed; measured freeze remains correctly blocked."
exit 0
