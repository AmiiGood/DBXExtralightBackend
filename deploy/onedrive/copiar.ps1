<#
  Copia los Excel que OneDrive sincroniza de SharePoint a una carpeta de red
  que el DBX sí puede leer (\\172.16.101.124\AREAS\...).

  Por qué: Finproject no autorizó que el DBX lea SharePoint directo, el
  servidor (Windows Server) no puede sincronizar OneDrive, y compartir la
  carpeta desde la laptop chocaría con el firewall. Aquí la laptop EMPUJA la
  copia hacia la red: es la misma conexión que ya usa la persona para abrir
  AREAS.

  Lo corre la tarea "DBX - copiar archivos de SharePoint" cada 15 minutos con
  la sesión de la persona (la instala instalar-copia.ps1). Lee la lista de
  archivos y el destino de copia.json, que está junto a este script.

  - Solo copia si cambió (tamaño o fecha de modificación distintos).
  - Copia con nombre temporal y luego renombra: el DBX nunca ve un archivo a
    medias.
  - Conserva la fecha de modificación de SharePoint: el DBX la usa para
    esperar a que nadie esté editando y para saber si cambió.
#>
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Get-Content (Join-Path $aqui 'copia.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$log = Join-Path $aqui 'copia.log'

function Anotar([string]$texto) {
  # Log chico: al pasar de 1 MB se guarda como .anterior
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.anterior" -Force }
  Add-Content -Path $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $texto" -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $config.destino)) {
  Anotar "No se alcanza el destino $($config.destino) (¿fuera de la red de la planta?). Se reintenta en la siguiente vuelta."
  return
}

foreach ($origen in $config.archivos) {
  $tmp = $null
  try {
    if (-not (Test-Path -LiteralPath $origen)) { Anotar "No está: $origen"; continue }
    $src = Get-Item -LiteralPath $origen
    $dst = Join-Path $config.destino $src.Name
    if (Test-Path -LiteralPath $dst) {
      $d = Get-Item -LiteralPath $dst
      if ($d.Length -eq $src.Length -and $d.LastWriteTimeUtc -eq $src.LastWriteTimeUtc) { continue }
    }
    $tmp = "$dst.copiando"
    Copy-Item -LiteralPath $src.FullName -Destination $tmp -Force
    (Get-Item -LiteralPath $tmp).LastWriteTimeUtc = $src.LastWriteTimeUtc
    Move-Item -LiteralPath $tmp -Destination $dst -Force
    Anotar ("Copiado {0} ({1:N1} MB, modificado {2})" -f $src.Name, ($src.Length / 1MB), $src.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))
  } catch {
    Anotar "Error con ${origen}: $($_.Exception.Message)"
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
}
