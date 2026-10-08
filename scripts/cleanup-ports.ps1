# Windows startup cleanup for RobloxAssetsCreator.
# Explicitly requested behavior: terminate listeners on the project's ports.
# This may also stop unrelated applications listening on these exact ports.
# Never touch ports beyond 3001, 5173, 5174 or a valid PORT override.
$ErrorActionPreference = 'Stop'
$ports = @(3001, 5173, 5174)
if ($env:PORT -match '^\d+$') {
  $customPort = [int]$env:PORT
  if ($customPort -ge 1 -and $customPort -le 65535) {
    $ports += $customPort
  }
}
$ports = @($ports | Sort-Object -Unique)

if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
  Write-Error 'Get-NetTCPConnection est indisponible. Impossible de verifier les ports sans risque.'
  exit 1
}

function Get-ListenerOwners {
  $ids = @(
    foreach ($port in $ports) {
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess
    }
  )
  return @($ids | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}

function Get-WatcherRoot([int]$ownerId) {
  # node --watch can restart a killed child. Stop its Node parent process tree.
  $root = $ownerId
  $seen = @{}
  for ($depth = 0; $depth -lt 8; $depth++) {
    if ($seen.ContainsKey($root)) { break }
    $seen[$root] = $true
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $root" -ErrorAction SilentlyContinue
    if (-not $processInfo) { break }
    $parentId = [int]$processInfo.ParentProcessId
    if ($parentId -le 4 -or $parentId -eq $PID) { break }
    $parentInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
    if (-not $parentInfo -or $parentInfo.Name -notin @('node.exe', 'node')) { break }
    $root = $parentId
  }
  return $root
}

Write-Host "[INFO] Verification des ports TCP $($ports -join ', ')"
for ($attempt = 1; $attempt -le 3; $attempt++) {
  $listeners = @(Get-ListenerOwners)
  if ($listeners.Count -eq 0) {
    Write-Host '[OK] Aucun processus a fermer sur les ports du projet.'
    exit 0
  }

  $roots = @(
    foreach ($ownerId in $listeners) {
      if ($ownerId -le 4 -or $ownerId -eq $PID) {
        Write-Error "Refus de terminer un processus systeme ou le nettoyage lui-meme : PID $ownerId."
        exit 1
      }
      Get-WatcherRoot $ownerId
    }
  ) | Sort-Object -Unique

  foreach ($rootId in $roots) {
    if (-not (Get-Process -Id $rootId -ErrorAction SilentlyContinue)) { continue }
    $name = (Get-Process -Id $rootId).ProcessName
    Write-Host "[INFO] Fermeture PID $rootId ($name) et processus enfants (taskkill /T /F)."
    & taskkill.exe /F /T /PID $rootId
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "La fermeture du processus $rootId a echoue ou il s'est deja termine."
    }
  }

  # The ancestor may have exited before taskkill. Stop any listener still alive.
  foreach ($ownerId in $listeners) {
    if ($ownerId -le 4 -or $ownerId -eq $PID) { continue }
    if (Get-Process -Id $ownerId -ErrorAction SilentlyContinue) {
      Write-Host "[INFO] Fermeture du processus a l'ecoute PID $ownerId."
      & taskkill.exe /F /T /PID $ownerId
    }
  }
  Start-Sleep -Milliseconds 700
}

$remaining = @(Get-ListenerOwners)
if ($remaining.Count -gt 0) {
  Write-Error "Ports toujours occupes par PID(s) $($remaining -join ', '). Arret du demarrage pour eviter une ancienne instance."
  exit 1
}
Write-Host '[OK] Tous les ports sont liberes.'
exit 0
