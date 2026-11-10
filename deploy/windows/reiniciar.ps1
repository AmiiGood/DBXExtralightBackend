<#
  Reinicia el backend y el frontend del DBX (las tareas que dejó instalar.ps1).
  Lo corre la tarea "DBX - reinicio semanal" y se puede correr a mano:
    powershell -ExecutionPolicy Bypass -File deploy\windows\reiniciar.ps1
  Con -Detener solo los detiene (arrancan otra vez al encender el equipo o con
  este mismo script sin -Detener).
#>
param([switch]$Detener)

. "$PSScriptRoot\comun.ps1"
Exigir-Administrador
$config = Leer-Config

Detener-Dbx $config.Frontend
if ($Detener) {
  Escribir 'DBX detenido.' 'Yellow'
  return
}
Iniciar-Dbx
[void](Revisar-Arranque $config)
