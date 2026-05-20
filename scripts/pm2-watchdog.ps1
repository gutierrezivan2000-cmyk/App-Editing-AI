# PM2 watchdog - corre cada 5 min via Task Scheduler.
#
# Verifica que:
#   1) El daemon PM2 este vivo
#   2) Los procesos `videoia-next` y `videoia-inngest` esten en status `online`
#
# Si alguna condicion falla, ejecuta `pm2 resurrect` para recuperar desde
# el dump (~/.pm2/dump.pm2). Si `pm2 resurrect` no es suficiente (porque
# el dump esta vacio), arranca desde ecosystem.config.js.
#
# Por que existe: PM2 daemon en Windows muere cuando:
#   - El usuario apaga la PC (el daemon es proceso del usuario, no servicio)
#   - Windows hace fast startup / cold boot
#   - El registry-based pm2-windows-startup corre al login pero npm puede
#     no estar todavia en PATH y falla silenciosamente
#   - Algun crash del propio PM2 daemon
#
# El watchdog cubre TODOS estos casos sin intervencion manual.
#
# Mantenido ASCII-only para no chocar con PowerShell 5.1 + codepage cp1252.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logFile     = Join-Path $PSScriptRoot "pm2-watchdog.log"
$ecosystem   = Join-Path $projectRoot "ecosystem.config.js"

# Capamos el log a 500 KB. Se rota borrando el viejo y empezando fresco.
$MAX_LOG_BYTES = 500000

function Log {
    param([string]$msg, [string]$level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$level] $msg"
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt $MAX_LOG_BYTES)) {
        Remove-Item $logFile -Force -ErrorAction SilentlyContinue
    }
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

# pm2 binary puede no estar en PATH cuando Task Scheduler corre al login
# o sin perfil completo. Agregamos npm-global a PATH defensivamente.
$npmGlobal = Join-Path $env:APPDATA "npm"
if ((Test-Path $npmGlobal) -and ($env:PATH -notlike "*$npmGlobal*")) {
    $env:PATH = "$npmGlobal;$env:PATH"
}

function Invoke-Pm2 {
    param([string]$pm2Args)
    # cmd /c bypassea el shim .ps1 que emite output raro al stderr.
    $output = cmd /c "pm2 $pm2Args 2>&1"
    return @{ exitCode = $LASTEXITCODE; output = ($output -join "`n") }
}

function Test-Pm2Process {
    # Devuelve $true si `pm2 pid <name>` retorna un PID numerico, lo que
    # significa que PM2 conoce el proceso y esta arriba. Evitamos parsear
    # JSON porque PM2 5.x emite claves case-insensitive duplicadas que
    # rompen ConvertFrom-Json en PowerShell 5.1.
    param([string]$name)
    $r = Invoke-Pm2 "pid $name"
    if ($r.exitCode -ne 0) { return $false }
    $line = ($r.output -split "`n" | Where-Object { $_ -match '^\s*\d+\s*$' } | Select-Object -First 1)
    return ($null -ne $line) -and ([int]$line.Trim() -gt 0)
}

function Recover-Process {
    # Si el proceso esta stopped/errored pero el daemon lo conoce, `pm2 restart`
    # lo levanta. Si NO lo conoce, `pm2 start ecosystem --only <name>` lo crea.
    param([string]$name)
    $restart = Invoke-Pm2 "restart $name"
    if ($restart.exitCode -eq 0 -and $restart.output -notmatch "not found|doesn't exist") {
        return $true
    }
    Log "pm2 restart $name no funciono, intentando 'pm2 start ecosystem --only $name'"
    $start = Invoke-Pm2 "start `"$ecosystem`" --only $name"
    return ($start.exitCode -eq 0)
}

try {
    # 1) Daemon vivo? `pm2 ping` retorna "pong" si lo esta.
    $ping = Invoke-Pm2 "ping"
    if ($ping.exitCode -ne 0 -or $ping.output -notmatch "pong") {
        # Daemon muerto -> resurrect levanta el daemon y restaura el dump.
        Log "pm2 ping fallo (exit $($ping.exitCode)); daemon muerto, ejecutando resurrect" "WARN"
        $resurrect = Invoke-Pm2 "resurrect"
        if ($resurrect.exitCode -ne 0) {
            Log "pm2 resurrect fallo: $($resurrect.output)" "ERROR"
            Log "fallback: pm2 start ecosystem" "INFO"
            $start = Invoke-Pm2 "start `"$ecosystem`""
            if ($start.exitCode -ne 0) {
                Log "pm2 start ecosystem fallo: $($start.output)" "ERROR"
                exit 1
            }
        }
        Start-Sleep -Seconds 6
    }

    # 2) Procesos individuales arriba? Recuperar uno a uno si hace falta.
    $recovered = $false
    if (-not (Test-Pm2Process "videoia-next")) {
        Log "videoia-next no esta online, recuperando" "WARN"
        Recover-Process "videoia-next" | Out-Null
        $recovered = $true
    }
    if (-not (Test-Pm2Process "videoia-inngest")) {
        Log "videoia-inngest no esta online, recuperando" "WARN"
        Recover-Process "videoia-inngest" | Out-Null
        $recovered = $true
    }

    if (-not $recovered) {
        # Todo OK. Salimos sin loguear para no llenar el log de heartbeats.
        exit 0
    }

    # Verificar post-recuperacion.
    Start-Sleep -Seconds 6
    $nextUp = Test-Pm2Process "videoia-next"
    $innUp  = Test-Pm2Process "videoia-inngest"
    Log "post-recuperacion: videoia-next=$nextUp, videoia-inngest=$innUp"

    # Si recuperamos algo, persistir el nuevo estado para el proximo boot.
    if ($nextUp -and $innUp) {
        Invoke-Pm2 "save" | Out-Null
    }
    exit 0

} catch {
    Log "EXCEPCION: $($_.Exception.Message)" "ERROR"
    exit 1
}
