@echo off
rem Sirve el frontend del DBX ya compilado (carpeta dist) y lo vuelve a
rem levantar si se cae. Lo ejecuta la tarea programada "DBX - frontend".
rem Log: logs\frontend.log del backend (todos los logs en un solo lugar).
rem
rem Parametros: %1 = carpeta del frontend, %2 = puerto (el mismo de siempre,
rem para que la direccion que usa la gente no cambie).
setlocal
set "FRONTEND=%~1"
set "PUERTO=%~2"
if not defined PUERTO set "PUERTO=5173"
cd /d "%~dp0..\.."
if not exist logs mkdir logs
set "LOG=%CD%\logs\frontend.log"

if exist "%~dp0node-dir.txt" set /p NODEDIR=<"%~dp0node-dir.txt"
if defined NODEDIR set "PATH=%NODEDIR%;%PATH%"
rem Sin colores: el log queda legible en el Bloc de notas
set "NO_COLOR=1"

cd /d "%FRONTEND%"

:arrancar
if exist "%LOG%" for %%A in ("%LOG%") do if %%~zA GTR 20971520 move /y "%LOG%" "%LOG%.anterior" >nul

echo.>> "%LOG%"
rem Sin compilar no hay nada que servir: se compila una vez
if not exist "%FRONTEND%\dist\index.html" (
  echo [%date% %time%] No hay dist: compilando >> "%LOG%"
  call npm.cmd run build >> "%LOG%" 2>&1
)
echo [%date% %time%] Sirviendo el frontend en el puerto %PUERTO% >> "%LOG%"
rem Ruta completa a vite: asi detener.ps1 reconoce este proceso
node "%FRONTEND%\node_modules\vite\bin\vite.js" preview --host 0.0.0.0 --port %PUERTO% --strictPort >> "%LOG%" 2>&1
echo [%date% %time%] El frontend se detuvo (codigo %errorlevel%). Se reinicia en 15 segundos >> "%LOG%"

ping -n 16 127.0.0.1 >nul
goto arrancar
