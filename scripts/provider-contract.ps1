param(
    [Parameter(Mandatory)][ValidateSet('openrouter','groq','codex','claude','ollama','lmstudio','llamacpp')][string]$Service,
    [Parameter(Mandatory)][string]$Models,
    [string]$Endpoint,
    [string]$Ledger = (Join-Path $env:TEMP 'clipes-contract-122-ledger.json')
)
$ErrorActionPreference = 'Stop'
# A persistent ledger counts sends BEFORE they start, including retries and repairs.
# Keep this file between runs; never reset it to bypass the authorized ceilings.
# Serialize script invocations so two services cannot overwrite the same ledger.
$probeMutex = [Threading.Mutex]::new($false, 'clipes-provider-contract-122')
if (-not $probeMutex.WaitOne(0)) { throw 'Another manual contract probe is running' }
try {
    if (-not (Test-Path -LiteralPath $Ledger)) {
        '{"openrouter":0,"groq":0,"codex":0,"claude":0,"ollama":0,"lmstudio":0,"llamacpp":0}' |
            Set-Content -LiteralPath $Ledger -Encoding utf8NoBOM
    }
    $env:CARGO_BUILD_JOBS = '2'
    $env:CLIPES_CONTRACT_AUTHORIZED = '122'
    $env:CLIPES_CONTRACT_SERVICE = $Service
    $env:CLIPES_CONTRACT_MODELS = $Models
    $env:CLIPES_CONTRACT_ENDPOINT = $Endpoint
    $env:CLIPES_CONTRACT_LEDGER = $Ledger
    $env:RUST_LOG = 'off'
    $env:RUST_BACKTRACE = '0'
    # CLIPES_GROQ_KEY_FILE / CLIPES_OPENROUTER_KEY_FILE are paths, never key values.
    # Only the core reads the files; it prints allowlisted measurements, never payloads.
    cargo test -p clipes-core --lib provider::contract_probe::real_provider_contract -- --exact --ignored --nocapture --test-threads=1
    if ($LASTEXITCODE -ne 0) { throw 'Manual provider contract probe failed' }
} finally {
    $probeMutex.ReleaseMutex()
    $probeMutex.Dispose()
}
