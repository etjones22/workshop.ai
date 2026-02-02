@echo off
setlocal enabledelayedexpansion

echo ============================================
echo Workshop.AI Windows Setup
echo ============================================

cd /d "%~dp0"
if not exist package.json (
  echo ERROR: package.json not found. Run this from the repo root.
  exit /b 1
)

set INSTALL_IDS=

call :check_cmd node "Node.js" "OpenJS.NodeJS.LTS"
call :check_cmd git "Git" "Git.Git"
call :check_cmd python "Python" "Python.Python.3.12"
call :check_cmd ollama "Ollama" "Ollama.Ollama"

if defined INSTALL_IDS (
  where winget >nul 2>&1
  if errorlevel 1 (
    echo.
    echo Missing prerequisites and winget is not available.
    echo Please install the missing items manually, then re-run setup.
    echo Required: Node.js, Git, Python, Ollama
    exit /b 1
  )

  echo.
  choice /m "Install missing prerequisites with winget"
  if errorlevel 2 goto after_install

  for %%I in (%INSTALL_IDS%) do (
    echo Installing %%I...
    winget install -e --id %%I
  )
)

:after_install
call :require_cmd node "Node.js"
call :require_cmd git "Git"
call :require_cmd python "Python"
call :require_cmd ollama "Ollama"

echo.
echo Installing npm dependencies...
call npm install
if errorlevel 1 goto error

echo.
echo Building project...
call npm run build
if errorlevel 1 goto error

echo.
choice /m "Pull Ollama model gpt-oss:20b now"
if errorlevel 2 goto done
call ollama pull gpt-oss:20b
if errorlevel 1 goto error

:done
echo.
echo Setup complete.
echo Run: npm start -- chat
exit /b 0

:check_cmd
set CMD=%~1
set LABEL=%~2
set ID=%~3
where %CMD% >nul 2>&1
if errorlevel 1 (
  echo Missing %LABEL%.
  if not "%ID%"=="" (
    set INSTALL_IDS=!INSTALL_IDS! %ID%
  )
)
exit /b 0

:require_cmd
set CMD=%~1
set LABEL=%~2
where %CMD% >nul 2>&1
if errorlevel 1 (
  echo ERROR: %LABEL% is still missing. Please install and re-run setup.
  exit /b 1
)
exit /b 0

:error
echo.
echo Setup failed. Fix the errors above and re-run setup.
exit /b 1
