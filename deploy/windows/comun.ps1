# Lo que comparten instalar, reiniciar, detener y actualizar.
# Se carga con:  . "$PSScriptRoot\comun.ps1"

$ErrorActionPreference = 'Stop'

$script:Backend = (Resolve-Path "$PSScriptRoot\..\..").Path
$script:Logs = Join-Path $script:Backend 'logs'
$script:ArchivoConfig = Join-Path $PSScriptRoot 'instalacion.json'

$script:TareaBackend = 'DBX - backend'
$script:TareaFrontend = 'DBX - frontend'
$script:TareaReinicio = 'DBX - reinicio semanal'

function Escribir([string]$texto, [string]$color = 'Gray') { Write-Host $texto -ForegroundColor $color }

function Exigir-Administrador {
  $yo = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $yo.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Abre PowerShell como administrador (clic derecho > Ejecutar como administrador) y vuelve a correrlo.'
  }
}

# Lo que eligió el instalador: carpeta del frontend y puertos
function Leer-Config {
  if (-not (Test-Path $script:ArchivoConfig)) { throw 'El DBX no está instalado como tarea. Corre primero instalar.ps1.' }
  Get-Content $script:ArchivoConfig -Raw | ConvertFrom-Json
}

# PORT= del .env del backend (3000 si no viene)
function Puerto-Backend {
  $linea = Get-Content (Join-Path $script:Backend '.env') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
  if ($linea -and $linea -match '(\d+)') { return [int]$Matches[1] }
  return 3000
}

function Puerto-Abierto([int]$puerto) {
  $cliente = New-Object System.Net.Sockets.TcpClient
  try {
    $intento = $cliente.BeginConnect('127.0.0.1', $puerto, $null, $null)
    return ($intento.AsyncWaitHandle.WaitOne(1000) -and $cliente.Connected)
  } catch { return $false } finally { $cliente.Close() }
}

function Esperar-Puerto([int]$puerto, [int]$segundos = 90) {
  $fin = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $fin) {
    if (Puerto-Abierto $puerto) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# Procesos de node del DBX: el backend (server.js) y el frontend (vite preview),
# reconocidos por la ruta completa con la que los lanzan los iniciar-*.cmd
function Procesos-Dbx([string]$frontend) {
  $back = [regex]::Escape((Join-Path $script:Backend 'server.js'))
  $front = if ($frontend) { [regex]::Escape((Join-Path $frontend 'node_modules\vite\bin\vite.js')) } else { $null }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" | Where-Object {
    $c = $_.CommandLine
    $c -and (
      $c -match $back -or ($front -and $c -match $front) -or
      $c -match 'iniciar-backend\.cmd' -or $c -match 'iniciar-frontend\.cmd'
    )
  }
}

function Detener-Dbx([string]$frontend) {
  foreach ($t in @($script:TareaBackend, $script:TareaFrontend)) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    }
  }
  # Detener la tarea cierra el cmd, pero node puede quedar vivo: se cierra aparte.
  # Primero los cmd (para que no lo vuelvan a levantar) y luego node.
  $procesos = @(Procesos-Dbx $frontend | Sort-Object { if ($_.Name -eq 'cmd.exe') { 0 } else { 1 } })
  foreach ($p in $procesos) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($procesos.Count) { Start-Sleep -Seconds 2 }
}

function Iniciar-Dbx {
  Start-ScheduledTask -TaskName $script:TareaBackend
  Start-ScheduledTask -TaskName $script:TareaFrontend
}

# Espera a que respondan los dos y dice cómo quedó
function Revisar-Arranque($config) {
  $pb = Puerto-Backend
  Escribir "Esperando a que respondan (backend $pb, frontend $($config.PuertoFrontend))..."
  $okB = Esperar-Puerto $pb
  $okF = Esperar-Puerto $config.PuertoFrontend
  if ($okB) { Escribir "  Backend arriba en el puerto $pb" 'Green' }
  else { Escribir "  El backend no respondió. Revisa $($script:Logs)\backend.log" 'Red' }
  if ($okF) { Escribir "  Frontend arriba en el puerto $($config.PuertoFrontend)" 'Green' }
  else { Escribir "  El frontend no respondió. Revisa $($script:Logs)\frontend.log" 'Red' }
  return ($okB -and $okF)
}

function Npm([string]$carpeta, [string[]]$argumentos) {
  Push-Location $carpeta
  try {
    & npm.cmd @argumentos
    if ($LASTEXITCODE -ne 0) { throw "Falló 'npm $($argumentos -join ' ')' en $carpeta" }
  } finally { Pop-Location }
}
