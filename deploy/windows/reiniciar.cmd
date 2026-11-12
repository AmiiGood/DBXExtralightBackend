@echo off
rem Reiniciar con doble clic.
rem Pide permisos de administrador si no los tiene, corre el .ps1 de esta
rem misma carpeta y deja la ventana abierta para leer el resultado.

fltmc >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

title DBX - Reiniciar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reiniciar.ps1"
echo.
if errorlevel 1 (echo Termino con error: revisa los mensajes de arriba.) else (echo Listo.)
pause
