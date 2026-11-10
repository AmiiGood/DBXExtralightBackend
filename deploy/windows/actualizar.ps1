<#
  Trae la versión nueva del DBX y la deja corriendo:
    1. git pull en el backend y en el frontend
    2. npm ci donde cambió package-lock.json
    3. compila el frontend
    4. si el pull trajo migraciones nuevas, se detiene y las lista (se aplican
       a mano, como dice cada DESPLIEGUE_*.md, y luego se corre reiniciar.ps1)
    5. si no, reinicia los dos

  Uso (PowerShell como administrador, desde la carpeta del backend):
    powershell -ExecutionPolicy Bypass -File deploy\windows\actualizar.ps1
#>
. "$PSScriptRoot\comun.ps1"
Exigir-Administrador
$config = Leer-Config

function Correr-Git([string]$carpeta, [string[]]$argumentos) {
  # git escribe su avance en stderr: con 'Stop', PowerShell 5.1 lo tomaría como error
  $ErrorActionPreference = 'Continue'
  $salida = & git -C $carpeta @argumentos 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { throw "Falló 'git $($argumentos -join ' ')' en ${carpeta}:`n$salida" }
  return $salida
}

$migraciones = @()
$detenido = $false
foreach ($carpeta in @($script:Backend, $config.Frontend)) {
  Escribir "Actualizando $carpeta..."
  $antes = (Correr-Git $carpeta @('rev-parse', 'HEAD')).Trim()
  $lockAntes = (Get-FileHash (Join-Path $carpeta 'package-lock.json')).Hash
  Correr-Git $carpeta @('pull', '--ff-only') | ForEach-Object { Escribir "  $_" }
  $despues = (Correr-Git $carpeta @('rev-parse', 'HEAD')).Trim()
  if ($antes -eq $despues) { Escribir '  Sin cambios'; continue }

  if ((Get-FileHash (Join-Path $carpeta 'package-lock.json')).Hash -ne $lockAntes) {
    Escribir '  Cambiaron las dependencias: npm ci'
    Detener-Dbx $config.Frontend   # node_modules no se puede reemplazar con node corriendo
    $detenido = $true
    Npm $carpeta @('ci')
  }
  if ($carpeta -eq $script:Backend) {
    $migraciones = @(Correr-Git $carpeta @('diff', '--name-only', '--diff-filter=A', $antes, $despues, '--', 'migrations') |
      ForEach-Object { Split-Path $_ -Leaf })
  }
}

Escribir 'Compilando el frontend...'
Npm $config.Frontend @('run', 'build')

if ($migraciones.Count) {
  Escribir ''
  Escribir 'La actualización trae migraciones nuevas. Aplícalas (después de respaldar la base):' 'Yellow'
  Escribir "  cd `"$($script:Backend)`"" 'Yellow'
  Escribir "  node scripts/aplicar-migracion.js $($migraciones -join ' ')" 'Yellow'
  Escribir 'y luego reinicia:' 'Yellow'
  Escribir '  powershell -ExecutionPolicy Bypass -File deploy\windows\reiniciar.ps1' 'Yellow'
  if ($detenido) { Escribir '(El DBX quedó DETENIDO para cambiar dependencias: arranca al correr reiniciar.ps1.)' 'Yellow' }
  else { Escribir '(El DBX sigue corriendo con el código anterior hasta que lo reinicies.)' }
  return
}

Detener-Dbx $config.Frontend
Iniciar-Dbx
[void](Revisar-Arranque $config)
