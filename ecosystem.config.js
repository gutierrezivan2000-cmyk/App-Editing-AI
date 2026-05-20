// PM2 process manifest.
//
// Levanta dos procesos:
//   - videoia-next:    el dev server de Next.js (npm run dev en puerto 3000)
//   - videoia-inngest: el inngest-cli dev (puerto 8288, descubre /api/inngest)
//
// Reglas:
//   - autorestart=true     -> si el proceso crashea, PM2 lo levanta solo
//   - max_restarts=10      -> hasta 10 intentos antes de marcarlo "errored"
//   - restart_delay=3000   -> espera 3s entre intentos
//   - env.ANTHROPIC_API_KEY="" -> override de la sensitive que viene vacía de
//                                 la shell del usuario; .env.local manda
//
// Uso:
//   pm2 start ecosystem.config.js   -> arranca ambos
//   pm2 restart videoia-next        -> reinicia solo Next (post refresh OIDC)
//   pm2 logs                        -> logs en vivo de ambos
//   pm2 status                      -> tabla de estado
//   pm2 save                        -> persiste para auto-start al boot

const path = require("path");
const cwd = __dirname;

module.exports = {
  apps: [
    {
      // Daemon que cada 6h refresca VERCEL_OIDC_TOKEN en .env.local y
      // reinicia videoia-next. Reemplaza al Task Scheduler de Windows que
      // fallaba por no tener las credenciales del CLI bajo su contexto.
      // PM2 hereda las credenciales del shell que lo arranco originalmente.
      name: "videoia-oidc-cron",
      cwd,
      script: path.join(cwd, "scripts", "oidc-cron.js"),
      interpreter: "node",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000,        // si crashea, esperar 30s antes de reintentar
      out_file: path.join(cwd, ".pm2-logs", "oidc-cron-out.log"),
      error_file: path.join(cwd, ".pm2-logs", "oidc-cron-err.log"),
      merge_logs: true,
    },
    {
      // Watchdog que cada 2 min mata pipelines estancados (sandbox muerto
      // sin que Inngest se haya enterado). Sin este, un proyecto puede
      // quedarse en "Processing" durante 45 min hasta que los retries
      // de Inngest se agoten.
      name: "videoia-stuck-cron",
      cwd,
      script: path.join(cwd, "scripts", "stuck-pipeline-cron.js"),
      interpreter: "node",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000,
      out_file: path.join(cwd, ".pm2-logs", "stuck-cron-out.log"),
      error_file: path.join(cwd, ".pm2-logs", "stuck-cron-err.log"),
      merge_logs: true,
    },
    {
      name: "videoia-next",
      cwd,
      // Wrapper que spawnea `next dev` con `windowsHide: true` para que no
      // aparezca la ventana "next-server (vX.Y.Z)" en Windows cada vez que
      // PM2 (re)arranca el proceso. Ver scripts/run-next.js para detalles.
      script: path.join(cwd, "scripts", "run-next.js"),
      interpreter: "node",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // Logs separados por proceso para no mezclar con Inngest.
      out_file: path.join(cwd, ".pm2-logs", "next-out.log"),
      error_file: path.join(cwd, ".pm2-logs", "next-err.log"),
      merge_logs: true,
      env: {
        // NOTA HISTORICA: antes pasabamos ANTHROPIC_API_KEY: "" para
        // sobrescribir un valor vacio que la shell de Claude Code tenia
        // por defecto. Pero PM2 propaga esto al subproceso ANTES de que
        // Next.js cargue .env.local, y Next respeta lo que viene en
        // process.env (no lo pisa con .env.local). Resultado: la API key
        // llegaba vacia al servidor pese a estar en .env.local.
        //
        // Solucion: NO sobrescribimos esa env aca. PM2 ya hereda solo lo
        // que el shell del usuario tenia al hacer `pm2 start`, y Next.js
        // se encarga de cargar .env.local para lo que falte.
        NODE_ENV: "development",
      },
    },
    {
      name: "videoia-inngest",
      cwd,
      // Apuntamos directo al binario nativo de inngest-cli instalado como
      // devDependency. Antes usábamos `cmd.exe /c npx inngest-cli@latest dev`
      // pero cmd.exe abría una ventana de consola visible en Windows cada
      // vez que PM2 (re)arrancaba el proceso. Llamando al .exe directo,
      // sin shell intermedio, PM2 spawnea el proceso headless y no aparece
      // ninguna ventana.
      script: path.join(cwd, "node_modules", "inngest-cli", "bin", "inngest.exe"),
      args: "dev",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: path.join(cwd, ".pm2-logs", "inngest-out.log"),
      error_file: path.join(cwd, ".pm2-logs", "inngest-err.log"),
      merge_logs: true,
      exec_mode: "fork",
    },
  ],
};
