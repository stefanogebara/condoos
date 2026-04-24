$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dbPath = Join-Path $env:TEMP ("condoos-e2e-{0}.sqlite" -f [guid]::NewGuid().ToString('N'))
$server = $null
$client = $null

function Stop-E2EStack {
  foreach ($process in @($client, $server)) {
    if ($null -ne $process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }

  Remove-Item -LiteralPath $dbPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "$dbPath-shm" -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "$dbPath-wal" -Force -ErrorAction SilentlyContinue
}

try {
  Write-Host "[e2e] DB_PATH=$dbPath"

  $env:DB_PATH = $dbPath
  $env:NODE_ENV = 'development'
  Push-Location $root
  try {
    npm --prefix server run seed
  } finally {
    Pop-Location
  }

  $env:NODE_ENV = 'production'
  $env:RATE_LIMIT_DISABLED = '1'
  $env:PORT = '4312'
  $env:JWT_SECRET = 'e2e-secret'
  $env:CORS_ORIGIN = 'http://localhost:5175'
  $server = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('--prefix', 'server', 'exec', '--', 'ts-node', 'src/server.ts') `
    -WorkingDirectory $root `
    -PassThru `
    -NoNewWindow

  $env:VITE_API_URL = 'http://localhost:4312/api'
  $client = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('--prefix', 'client-app', 'exec', '--', 'vite', '--host', 'localhost', '--port', '5175') `
    -WorkingDirectory $root `
    -PassThru `
    -NoNewWindow

  while ($true) {
    if ($server.HasExited) { throw "E2E API server exited with code $($server.ExitCode)" }
    if ($client.HasExited) { throw "E2E client server exited with code $($client.ExitCode)" }
    Start-Sleep -Seconds 1
  }
} finally {
  Stop-E2EStack
}
