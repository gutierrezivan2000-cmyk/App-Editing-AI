# Refresh del VERCEL_OIDC_TOKEN en .env.local sin tocar el resto del archivo.
#
# Por que existe: el OIDC de Vercel Sandbox vive ~12h. Al expirar, el pipeline
# rompe con "Could not get credentials from OIDC context" pero Next/Inngest
# siguen corriendo. Este script:
#   1) Hace `vercel env pull` a un archivo temporal
#   2) Extrae solo la linea VERCEL_OIDC_TOKEN=... del temporal
#   3) Reemplaza la linea homonima en .env.local
#   4) Borra el temporal
#   5) `pm2 restart videoia-next` para que Next levante el nuevo token
#
# NO toca ANTHROPIC_API_KEY ni OPENAI_API_KEY ni AUTH_SECRET (esas vienen
# vacias en vercel env pull porque son "Sensitive" en Vercel).
#
# Disenado para correr desatendido desde Task Scheduler:
#   - Sin prompts interactivos
#   - Loguea todo a scripts/refresh-oidc.log con timestamp
#   - Exit code 0 si ok, 1 si fallo (para que Task Scheduler lo registre)
#
# Mantenido ASCII-only para no chocar con PowerShell 5.1 + codepage cp1252.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envLocal   = Join-Path $projectRoot ".env.local"
$tempEnv    = Join-Path $projectRoot ".env.vercel.fresh"
$logFile    = Join-Path $PSScriptRoot "refresh-oidc.log"

# Vercel CLI guarda el auth en %APPDATA%\xdg.data\com.vercel.cli\auth.json
# (XDG_DATA_HOME). Task Scheduler corre con un entorno limpio, asi que
# tenemos dos estrategias en el bloque principal:
#  1) VERCEL_TOKEN en .env.local -> se pasa con --token (lo mas robusto)
#  2) Sin token, seteamos XDG_DATA_HOME apuntando al auth.json local

function Log {
    param([string]$msg, [string]$level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$level] $msg"
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Output $line
}

try {
    Log "==== refresh-oidc start ===="
    Set-Location $projectRoot

    if (-not (Test-Path $envLocal)) {
        Log ".env.local no existe en $projectRoot" "ERROR"
        exit 1
    }

    # Backup defensivo: .env.local.bak siempre apunta al ultimo estado bueno.
    Copy-Item $envLocal "$envLocal.bak" -Force
    Log "backup creado en .env.local.bak"

    # 1) Si hay VERCEL_TOKEN en .env.local (PAT del usuario), usamos --token.
    #    Esto es lo MAS robusto: bypassea cualquier resolucion por entorno.
    # 2) Si NO hay PAT, dependemos del auth.json del CLI. Task Scheduler
    #    corre sin las env vars XDG, asi que las seteamos a mano apuntando
    #    a donde el CLI las escribio cuando hicimos `vercel login` desde
    #    una shell normal.
    $vercelTokenLine = if (Test-Path $envLocal) {
        Select-String -Path $envLocal -Pattern '^VERCEL_TOKEN=' | Select-Object -First 1
    } else { $null }
    $vercelPat = $null
    if ($vercelTokenLine) {
        $vercelPat = $vercelTokenLine.Line.Split('=', 2)[1].Trim('"').Trim("'")
        if ($vercelPat.Length -lt 10) { $vercelPat = $null }
    }

    if ($vercelPat) {
        Log "usando VERCEL_TOKEN de .env.local (PAT)"
        $pullCmd = "vercel env pull `"$tempEnv`" --environment=production --yes --token=$vercelPat 2>&1"
    } else {
        # Asegurar que el CLI encuentre el auth.json. Buscamos en los paths
        # conocidos y seteamos XDG_DATA_HOME al que tenga el archivo.
        $xdgDataHome = $null
        foreach ($candidate in @(
            "$env:APPDATA\xdg.data",
            "$env:USERPROFILE\AppData\Roaming\xdg.data",
            "$env:USERPROFILE\.local\share"
        )) {
            if (Test-Path "$candidate\com.vercel.cli\auth.json") {
                $xdgDataHome = $candidate
                break
            }
        }
        if (-not $xdgDataHome) {
            Log "No se encontro auth.json del CLI ni VERCEL_TOKEN en .env.local" "ERROR"
            Log "Soluciones: 1) corre 'vercel login' interactivo desde una shell normal; 2) crea un PAT en vercel.com/account/tokens y agregalo como VERCEL_TOKEN=xxx en .env.local" "ERROR"
            exit 1
        }
        Log "usando auth.json del CLI (XDG_DATA_HOME=$xdgDataHome)"
        $env:XDG_DATA_HOME = $xdgDataHome
        $pullCmd = "vercel env pull `"$tempEnv`" --environment=production --yes 2>&1"
    }

    # Usamos cmd /c para evitar el shim vercel.ps1 que emite output raro al
    # stderr (un <claude-code-hint .../> tag que con 2>&1 se convierte en
    # ErrorRecord y dispara $ErrorActionPreference=Stop).
    Log "ejecutando vercel env pull"
    $pullOutput = cmd /c $pullCmd
    if ($LASTEXITCODE -ne 0) {
        $safe = ($pullOutput -join "`n")
        if ($vercelPat) { $safe = $safe -replace [regex]::Escape($vercelPat), "***TOKEN***" }
        Log "vercel env pull fallo (exit $LASTEXITCODE): $safe" "ERROR"
        exit 1
    }

    if (-not (Test-Path $tempEnv)) {
        Log "vercel env pull no creo $tempEnv" "ERROR"
        exit 1
    }

    # Extraer linea OIDC del fresco.
    $freshLine = Select-String -Path $tempEnv -Pattern '^VERCEL_OIDC_TOKEN=' | Select-Object -First 1
    if (-not $freshLine) {
        Log "VERCEL_OIDC_TOKEN no encontrado en $tempEnv" "ERROR"
        Remove-Item $tempEnv -Force -ErrorAction SilentlyContinue
        exit 1
    }

    $newLine = $freshLine.Line
    Log "nuevo OIDC obtenido (length=$($newLine.Length))"

    # Reemplazar en .env.local sin tocar el resto.
    $local = Get-Content $envLocal -Raw
    if ($local -match '(?m)^VERCEL_OIDC_TOKEN=.*$') {
        $newLocal = $local -replace '(?m)^VERCEL_OIDC_TOKEN=.*$', $newLine
        Log "VERCEL_OIDC_TOKEN reemplazado en .env.local"
    } else {
        # Si no existia la linea, la agregamos al final.
        $newLocal = $local.TrimEnd("`r","`n") + "`n" + $newLine + "`n"
        Log "VERCEL_OIDC_TOKEN agregado al final de .env.local"
    }
    Set-Content -Path $envLocal -Value $newLocal -NoNewline -Encoding utf8

    # Limpieza.
    Remove-Item $tempEnv -Force -ErrorAction SilentlyContinue

    # Reiniciar Next para que recargue el .env.local. Inngest no necesita
    # el OIDC, no hace falta reiniciarlo.
    Log "ejecutando: pm2 restart videoia-next"
    $restartOutput = & pm2 restart videoia-next 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "pm2 restart fallo (probablemente PM2 no levantado): $restartOutput" "WARN"
        # No falla el script - al usuario igual le sirve tener el .env.local
        # actualizado para el proximo arranque manual.
    } else {
        Log "pm2 restart videoia-next OK"
    }

    Log "==== refresh-oidc done ===="
    exit 0

} catch {
    Log "EXCEPCION: $($_.Exception.Message)" "ERROR"
    Log $_.ScriptStackTrace "ERROR"
    exit 1
}
