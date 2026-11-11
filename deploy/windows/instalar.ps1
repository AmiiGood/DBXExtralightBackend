<#
  Deja el DBX arrancando solo: al encender el equipo (sin que nadie inicie
  sesión) y cada vez que se caiga.

  Registra en el Programador de tareas:
    DBX - backend          node server.js        (logs\backend.log)
    DBX - frontend         vite preview de dist  (logs\frontend.log)
    DBX - reinicio semanal domingo 04:00: reinicia los dos y así rota los logs

  Uso (PowerShell como administrador, desde la carpeta del backend):
    powershell -ExecutionPolicy Bypass -File deploy\windows\instalar.ps1
    ... -Usuario DOMINIO\usuario  corre con esa cuenta en vez de SYSTEM (ver abajo)
    ... -ProbarRuta "\\servidor\carpeta"  con -Usuario: revisa que esa cuenta la pueda leer
    ... -Frontend D:\DBX\DBXExtralightFrontend -PuertoFrontend 5173
    ... -Forzar      cierra lo que ya esté ocupando los puertos (las consolas de antes)
    ... -Quitar      detiene el DBX y borra las tareas

  ¿SYSTEM o una cuenta? SYSTEM no necesita contraseña, pero en la red entra
  como la cuenta del EQUIPO, no como una persona: las carpetas compartidas
  (Customer Service, CAPEX, AIMS en \\172.16.101.124\AREAS) le dicen "sin
  permiso" aunque tú sí entres. Con -Usuario las tareas corren con esa cuenta
  y entran a la red con sus permisos. Pide la contraseña una vez y la guarda
  el Programador de tareas; si la contraseña cambia, vuelve a correr esto.

  Se puede volver a correr cuantas veces sea: reemplaza las tareas.
#>
param(
  [string]$Usuario,
  [string]$ProbarRuta,
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
# 1b. Con qué cuenta corren las tareas (antes de detener nada: si la
#     contraseña está mal, el DBX sigue arriba como estaba)
# ---------------------------------------------------------------------------
$anterior = if (Test-Path $script:ArchivoConfig) { (Leer-Config).Usuario } else { $null }
$credencial = $null
if ($Usuario) {
  $credencial = Get-Credential -UserName $Usuario -Message "Contraseña de $Usuario. La guarda el Programador de tareas para arrancar el DBX sin que nadie inicie sesión."
  if (-not $credencial) { throw 'Sin contraseña no se puede registrar la tarea con esa cuenta.' }
  $clave = $credencial.GetNetworkCredential().Password

  # El Programador de tareas valida la contraseña al registrar: se prueba con
  # una tarea desechable. Con -ProbarRuta, esa tarea además revisa la carpeta.
  $tmp = Join-Path $env:SystemRoot "Temp\dbx-prueba-$([guid]::NewGuid().ToString('N')).txt"
  $orden = if ($ProbarRuta) {
    $ruta = $ProbarRuta -replace "'", "''"
    '$(if (Test-Path -LiteralPath ''{0}'') {{ ''SI'' }} else {{ ''NO'' }}) | Set-Content -LiteralPath ''{1}''' -f $ruta, $tmp
  } else { '''OK'' | Set-Content -LiteralPath ''{0}''' -f $tmp }
  $accionP = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -Command `"$orden`""
  # Sin estos ajustes, en un equipo con batería la tarea se queda "en cola"
  $ajustesP = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  try {
    Register-ScheduledTask -TaskName 'DBX - prueba de cuenta' -Action $accionP -Settings $ajustesP -User $credencial.UserName -Password $clave `
      -RunLevel Highest -Force -ErrorAction Stop | Out-Null
  } catch {
    throw "No se pudo usar la cuenta $($credencial.UserName): $($_.Exception.Message)"
  }
  try {
    Start-ScheduledTask -TaskName 'DBX - prueba de cuenta'
    $fin = (Get-Date).AddSeconds(40)
    while (-not (Test-Path $tmp) -and (Get-Date) -lt $fin) { Start-Sleep -Seconds 1 }
    $resultado = if (Test-Path $tmp) { (Get-Content $tmp -Raw).Trim() } else { $null }
  } finally {
    Unregister-ScheduledTask -TaskName 'DBX - prueba de cuenta' -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
  if (-not $resultado) { throw "La cuenta $($credencial.UserName) no pudo correr una tarea de prueba. ¿Tiene permiso de 'Iniciar sesión como proceso por lotes'?" }
  if ($ProbarRuta -and $resultado -ne 'SI') {
    throw "La cuenta $($credencial.UserName) NO puede leer '$ProbarRuta'. Usa otra cuenta o pide a TI el permiso de lectura."
  }
  Escribir "Cuenta: $($credencial.UserName) (contraseña correcta$(if ($ProbarRuta) { ", sí lee $ProbarRuta" }))" 'Green'
} else {
  Escribir 'Cuenta: SYSTEM (no entra a carpetas compartidas de la red; para eso usa -Usuario)'
  if ($anterior) { Escribir "  Ojo: antes corría con $anterior. Para seguir con esa cuenta, agrega -Usuario $anterior" 'Yellow' }
}

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

# Backend y frontend corren con la cuenta elegida (o SYSTEM). Con cuenta, la
# tarea es "ejecutar aunque el usuario no haya iniciado sesión".
function Registrar-Tarea($nombre, $accion, $descripcion) {
  $comunes = @{ TaskName = $nombre; Action = $accion; Trigger = $alEncender; Settings = $ajustes; Description = $descripcion; Force = $true }
  if ($credencial) {
    Register-ScheduledTask @comunes -User $credencial.UserName -Password $clave -RunLevel Highest | Out-Null
  } else {
    Register-ScheduledTask @comunes -Principal $sistema | Out-Null
  }
}

$accionB = New-ScheduledTaskAction -Execute (Join-Path $PSScriptRoot 'iniciar-backend.cmd') -WorkingDirectory $script:Backend
Registrar-Tarea $script:TareaBackend $accionB 'Backend del DBX Extralight. Arranca al encender el equipo y se levanta solo si se cae. Log: logs\backend.log'

$accionF = New-ScheduledTaskAction -Execute (Join-Path $PSScriptRoot 'iniciar-frontend.cmd') `
  -Argument "`"$Frontend`" $PuertoFrontend" -WorkingDirectory $Frontend
Registrar-Tarea $script:TareaFrontend $accionF 'Frontend del DBX Extralight (dist con vite preview). Arranca al encender el equipo y se levanta solo si se cae. Log: logs\frontend.log del backend'

$accionR = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\reiniciar.ps1`"" -WorkingDirectory $script:Backend
$ajustesR = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $script:TareaReinicio -Action $accionR `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '04:00') -Principal $sistema -Settings $ajustesR `
  -Description 'Reinicia el DBX los domingos a las 04:00: libera memoria y rota los logs que pasen de 20 MB.' -Force | Out-Null

[pscustomobject]@{
  Frontend = $Frontend; PuertoFrontend = $PuertoFrontend
  Usuario = if ($credencial) { $credencial.UserName } else { $null }
  Instalado = (Get-Date).ToString('yyyy-MM-dd HH:mm')
} |
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
