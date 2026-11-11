<#
  Instala en la laptop (o PC) que sincroniza SharePoint con OneDrive la tarea
  que copia los Excel a una carpeta de red para el DBX. Ver copiar.ps1.

  NO necesita administrador: la tarea es de la persona y corre solo mientras
  tiene la sesión iniciada (que es cuando OneDrive sincroniza).

  Uso (PowerShell normal, desde esta carpeta):
    powershell -ExecutionPolicy Bypass -File instalar-copia.ps1 `
      -Archivos "C:\Users\...\Finproject S.p.A\KPI's - Production\Produccion Inyección.xlsx" `
      -Destino "\\172.16.101.124\AREAS\IT\DBX\SharePoint"

    ... -CadaMinutos 15   cada cuánto revisa (15 por omisión)
    ... -Quitar           borra la tarea (deja la carpeta y las copias)

  Se puede volver a correr para cambiar los archivos o el destino.
#>
param(
  [string[]]$Archivos,
  [string]$Destino,
  [int]$CadaMinutos = 15,
  [switch]$Quitar
)
$ErrorActionPreference = 'Stop'
$tarea = 'DBX - copiar archivos de SharePoint'
$casa = Join-Path $env:LOCALAPPDATA 'DBX-copia'

if ($Quitar) {
  if (Get-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $tarea -Confirm:$false
    Write-Host "Tarea borrada. Las copias en la red y $casa se quedan." -ForegroundColor Green
  } else { Write-Host 'No había tarea instalada.' }
  return
}

if (-not $Archivos -or -not $Destino) { throw 'Faltan -Archivos y -Destino (ver el inicio de este script).' }

# Con "powershell -File", varias rutas separadas por coma llegan como UN solo
# texto. Se separan solo donde la coma va seguida de otra ruta (C:\ o \\), así
# no se rompe un nombre de archivo que traiga coma.
$Archivos = @($Archivos | ForEach-Object { $_ -split '\s*[,;]\s*(?=[A-Za-z]:\\|\\\\)' } |
  ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ })

# 1. Los archivos de origen tienen que existir (y estar sincronizados)
foreach ($a in $Archivos) {
  if (-not (Test-Path -LiteralPath $a)) { throw "No existe: $a. ¿Está sincronizada esa carpeta de SharePoint?" }
}

# 2. El destino: se crea si falta y se prueba que se pueda escribir
if (-not (Test-Path -LiteralPath $Destino)) {
  New-Item -ItemType Directory -Path $Destino -Force | Out-Null
  Write-Host "Carpeta creada: $Destino"
}
$prueba = Join-Path $Destino ".dbx-prueba-$PID"
try {
  Set-Content -LiteralPath $prueba -Value 'ok'
  Remove-Item -LiteralPath $prueba -Force
} catch {
  throw "No puedes escribir en $Destino. Elige otra carpeta o pide permiso de escritura."
}

# 3. El script y su configuración, en tu perfil (no dependen de dónde esté el repo)
New-Item -ItemType Directory -Path $casa -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'copiar.ps1') -Destination $casa -Force
[pscustomobject]@{ destino = $Destino; archivos = @($Archivos) } | ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $casa 'copia.json') -Encoding UTF8

# Un .vbs lanza PowerShell oculto: sin él, cada 15 minutos parpadearía una ventana
$script = Join-Path $casa 'copiar.ps1'
$vbs = Join-Path $casa 'copiar-oculto.vbs'
Set-Content -LiteralPath $vbs -Encoding ASCII -Value (
  'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""' + $script + '""", 0, True'
)

# 4. La tarea: al iniciar sesión y cada N minutos, solo con la sesión iniciada
$yo = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$accion = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$cada = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $CadaMinutos) -RepetitionDuration (New-TimeSpan -Days 3650)
$alEntrar = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $tarea -Action $accion -Trigger @($cada, $alEntrar) -Principal $yo -Settings $ajustes `
  -Description "Copia los Excel de SharePoint (sincronizados con OneDrive) a $Destino para el DBX. Log: $casa\copia.log" -Force | Out-Null

# 5. Una vuelta ahora mismo, para ver que copie
Write-Host 'Copiando por primera vez (puede tardar si OneDrive tiene que bajar el archivo)...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script
Get-Content (Join-Path $casa 'copia.log') -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
foreach ($a in $Archivos) {
  $copia = Join-Path $Destino (Split-Path $a -Leaf)
  if (Test-Path -LiteralPath $copia) { Write-Host "  OK: $copia" -ForegroundColor Green }
  else { Write-Host "  Falta: $copia (revisa el log)" -ForegroundColor Yellow }
}
Write-Host ''
Write-Host "Listo. Cada $CadaMinutos minutos, mientras tengas la sesión iniciada, se copia lo que haya cambiado." -ForegroundColor Green
Write-Host "En el DBX (Archivos de SharePoint), pon como ubicación: $Destino"
