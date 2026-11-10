<#
  Deja el DBX arrancando solo: al encender el equipo (sin que nadie inicie
  sesión) y cada vez que se caiga.

  Registra en el Programador de tareas, como SYSTEM:
    DBX - backend          node server.js        (logs\backend.log)
    DBX - frontend         vite preview de dist  (logs\frontend.log)
    DBX - reinicio semanal domingo 04:00: reinicia los dos y así rota los logs

  Uso (PowerShell como administrador, desde la carpeta del backend):
    powershell -ExecutionPolicy Bypass -File deploy\windows\instalar.ps1
    ... -Frontend D:\DBX\DBXExtralightFrontend -PuertoFrontend 5173
    ... -Forzar      cierra lo que ya esté ocupando los puertos (las consolas de antes)
    ... -Quitar      detiene el DBX y borra las tareas

  Se puede volver a correr cuantas veces sea: reemplaza las tareas.
#>
param(
  [string]$Frontend,
  [int]$PuertoFrontend = 5173,
  [switch]$Forzar,
  [switch]$Quitar
)

. "$PSScriptRoot\comun.ps1"
Exigir-Administrador

if ($Quitar) {
  $front = if (Test-Path $script:ArchivoConfig) { (Leer-Config).Frontend } else { $Frontend }
  Detener-Dbx $front
  foreach ($t in @($script:TareaBackend, $script:TareaFrontend, $script:TareaReinicio)) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $t -Confirm:$false
      Escribir "Tarea borrada: $t"
    }
  }
  Remove-Item $script:ArchivoConfig -ErrorAction SilentlyContinue
  Escribir 'Listo. El DBX ya no arranca solo; se puede levantar a mano como antes.' 'Green'
  return
}

# ---------------------------------------------------------------------------
# 1. Carpetas, Node y configuración
# ---------------------------------------------------------------------------
if (-not $Frontend) { $Frontend = Join-Path (Split-Path $script:Backend -Parent) 'DBXExtralightFrontend' }
if (-not (Test-Path (Join-Path $Frontend 'package.json'))) {
  throw "No encuentro el frontend en '$Frontend'. Pásalo con -Frontend <carpeta>."
}
$Frontend = (Resolve-Path $Frontend).Path
if (-not (Test-Path (Join-Path $script:Backend '.env'))) { throw "Falta el .env del backend en $($script:Backend)" }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'No encuentro Node en el PATH. Instálalo o abre una consola donde "node -v" funcione.' }
# SYSTEM puede no tener a Node en su PATH (si se instaló solo para un usuario)
Set-Content -Path (Join-Path $PSScriptRoot 'node-dir.txt') -Value (Split-Path $node.Source -Parent) -Encoding ASCII
Escribir "Node $(& node -v) en $(Split-Path $node.Source -Parent)"

$PuertoBackend = Puerto-Backend
Escribir "Backend:  $($script:Backend)  (puerto $PuertoBackend, del .env)"
Escribir "Frontend: $Frontend  (puerto $PuertoFrontend)"

# ---------------------------------------------------------------------------
# 2. Lo que esté ocupando los puertos (las consolas de antes)
# ---------------------------------------------------------------------------
Detener-Dbx $Frontend
$ocupados = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in @($PuertoBackend, $PuertoFrontend) } |
  Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 4 })
if ($ocupados.Count) {
  $detalle = $ocupados | ForEach-Object {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $_"
    "  PID $_  $($p.Name)  $($p.CommandLine)"
  }
  if (-not $Forzar) {
    Escribir 'Los puertos ya están ocupados, seguramente por las consolas donde se levantaba a mano:' 'Yellow'
    $detalle | ForEach-Object { Escribir $_ 'Yellow' }
    throw 'Cierra esas consolas y vuelve a correrlo, o agrega -Forzar para cerrarlas desde aquí.'
  }
  Escribir 'Cerrando lo que ocupa los puertos:' 'Yellow'
  $detalle | ForEach-Object { Escribir $_ 'Yellow' }
  foreach ($id in $ocupados) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# ---------------------------------------------------------------------------
# 3. Dependencias y compilación del frontend
# ---------------------------------------------------------------------------
foreach ($carpeta in @($script:Backend, $Frontend)) {
  if (-not (Test-Path (Join-Path $carpeta 'node_modules'))) {
    Escribir "Instalando dependencias en $carpeta..."
    Npm $carpeta @('ci')
  }
}
Escribir 'Compilando el frontend (npm run build)...'
Npm $Frontend @('run', 'build')

# ---------------------------------------------------------------------------
# 4. Tareas
# ---------------------------------------------------------------------------
$sistema = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
# Sin límite de tiempo (Windows las corta a las 72 h por omisión) y, si la tarea
# misma falla, otro intento cada minuto. Que node se caiga lo cubre el cmd, que
# lo vuelve a levantar a los 15 segundos.
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$alEncender = New-ScheduledTaskTrigger -AtStartup

$accionB = New-ScheduledTaskAction -Execute (Join-Path $PSScriptRoot 'iniciar-backend.cmd') -WorkingDirectory $script:Backend
Register-ScheduledTask -TaskName $script:TareaBackend -Action $accionB -Trigger $alEncender -Principal $sistema `
  -Settings $ajustes -Description 'Backend del DBX Extralight. Arranca al encender el equipo y se levanta solo si se cae. Log: logs\backend.log' -Force | Out-Null

$accionF = New-ScheduledTaskAction -Execute (Join-Path $PSScriptRoot 'iniciar-frontend.cmd') `
  -Argument "`"$Frontend`" $PuertoFrontend" -WorkingDirectory $Frontend
Register-ScheduledTask -TaskName $script:TareaFrontend -Action $accionF -Trigger $alEncender -Principal $sistema `
  -Settings $ajustes -Description 'Frontend del DBX Extralight (dist con vite preview). Arranca al encender el equipo y se levanta solo si se cae. Log: logs\frontend.log del backend' -Force | Out-Null

$accionR = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\reiniciar.ps1`"" -WorkingDirectory $script:Backend
$ajustesR = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $script:TareaReinicio -Action $accionR `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '04:00') -Principal $sistema -Settings $ajustesR `
  -Description 'Reinicia el DBX los domingos a las 04:00: libera memoria y rota los logs que pasen de 20 MB.' -Force | Out-Null

[pscustomobject]@{ Frontend = $Frontend; PuertoFrontend = $PuertoFrontend; Instalado = (Get-Date).ToString('yyyy-MM-dd HH:mm') } |
  ConvertTo-Json | Set-Content -Path $script:ArchivoConfig -Encoding UTF8

Escribir "Tareas registradas: $($script:TareaBackend), $($script:TareaFrontend), $($script:TareaReinicio)" 'Green'

# ---------------------------------------------------------------------------
# 5. Arrancar y revisar
# ---------------------------------------------------------------------------
Iniciar-Dbx
if (Revisar-Arranque (Leer-Config)) {
  Escribir ''
  Escribir 'Listo. Desde ahora el DBX arranca solo al encender el equipo y se levanta si se cae.' 'Green'
  Escribir 'Ya no hace falta dejar consolas abiertas.' 'Green'
}
