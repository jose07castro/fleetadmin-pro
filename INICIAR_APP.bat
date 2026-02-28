@echo off
echo ============================================
echo   FleetAdmin Pro - Servidor Local
echo ============================================
echo.

:: Agregar Node.js al PATH
set PATH=C:\Program Files\nodejs;%PATH%

:: Verificar que Node.js esta instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado o no se encuentra.
    echo Descargalo de: https://nodejs.org
    pause
    exit /b 1
)

echo Node.js encontrado!
echo.

:: Cerrar cualquier servidor previo en el puerto 8080
echo Verificando puerto 8080...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080 " ^| findstr "LISTENING"') do (
    echo Cerrando proceso anterior en puerto 8080 (PID: %%a)...
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

cd /d "%~dp0"

:: Abrir navegador automaticamente (con pequeno delay para que el servidor arranque)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080"

echo =============================================
echo   Tu app esta abierta en el navegador!
echo   http://localhost:8080
echo =============================================
echo.
echo NO CIERRES esta ventana mientras uses la app.
echo Para detener el servidor presiona: Ctrl + C
echo.

node server.js
pause
