# TikTok Printer Live — Iniciar servidor
# Uso: .\run.ps1          (modo TikTok LIVE)
#      .\run.ps1 --mock   (modo simulador)

param(
    [switch]$mock
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   TikTok Printer Live - Iniciando..." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# --- Verificar Python ---
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[OK] Python encontrado: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Python no encontrado. Instala Python 3.10+ desde https://python.org" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

# --- Verificar/instalar dependencias ---
Write-Host ""
Write-Host "Verificando dependencias..." -ForegroundColor Yellow

$requirementsFile = Join-Path $ProjectDir "requirements.txt"
if (Test-Path $requirementsFile) {
    Write-Host "Instalando paquetes de requirements.txt..." -ForegroundColor Yellow
    python -m pip install -r requirements.txt --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Dependencias instaladas." -ForegroundColor Green
    } else {
        Write-Host "[WARN] Algunos paquetes pueden no haberse instalado. Intenta manualmente:" -ForegroundColor Yellow
        Write-Host "       pip install -r requirements.txt" -ForegroundColor White
    }
} else {
    Write-Host "[WARN] requirements.txt no encontrado." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Frontend : http://localhost:8000" -ForegroundColor Green
Write-Host "  WebSocket: ws://localhost:8765" -ForegroundColor Green
if ($mock) {
    Write-Host "  Modo     : SIMULADOR (sin TikTok)" -ForegroundColor Magenta
} else {
    Write-Host "  Modo     : TIKTOK LIVE" -ForegroundColor Green
}
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Presiona Ctrl+C para detener el servidor." -ForegroundColor Gray
Write-Host ""

# Abrir navegador automaticamente despues de 2 segundos
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:8000"
} | Out-Null

# --- Lanzar servidor ---
if ($mock) {
    python server.py --mock
} else {
    python server.py
}
