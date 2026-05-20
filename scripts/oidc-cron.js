// Daemon que cada 6 horas ejecuta refresh-oidc.ps1.
//
// Por qué no Task Scheduler:
//   Task Scheduler corre con un environment "limpio" que no incluye las
//   credenciales de Vercel CLI (guardadas bajo el perfil del usuario en
//   XDG_DATA_HOME). PM2, en cambio, fue arrancado por el usuario desde
//   una shell que SÍ tiene esas credenciales, y los procesos hijos las
//   heredan. Así que este cron INTERNO via PM2 sí puede llamar a vercel.
//
// Diseño:
//   - Loop infinito. Cada iteración duerme 6h, después ejecuta el script.
//   - Si el script falla, NO crasheamos el daemon: logueamos y seguimos.
//     Próximo intento en 6h. Mientras tanto, el OIDC actual sigue válido
//     (tienen ~12h de vida útil, refrescamos al medio).
//   - Una primera ejecución al arrancar (sin esperar 6h) por si el OIDC
//     del .env.local está expirado al boot.

const { spawn } = require("child_process");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const scriptPath = path.join(__dirname, "refresh-oidc.ps1");

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas

function runRefresh() {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        cwd: projectRoot,
        stdio: "inherit",          // logs van a los archivos de PM2
        windowsHide: true,         // sin ventana visible
      }
    );
    child.on("exit", (code) => {
      const ts = new Date().toISOString();
      if (code === 0) {
        console.log(`[oidc-cron] ${ts} refresh OK`);
      } else {
        console.error(`[oidc-cron] ${ts} refresh fallo (exit ${code})`);
      }
      resolve();
    });
    child.on("error", (err) => {
      console.error(`[oidc-cron] spawn error: ${err.message}`);
      resolve();
    });
  });
}

async function main() {
  console.log(`[oidc-cron] daemon iniciado, intervalo=${REFRESH_INTERVAL_MS}ms`);
  // Una corrida inicial al arrancar.
  await runRefresh();
  // Loop: dormir y ejecutar.
  // setInterval no awaitea -> si una corrida tarda 5s, no se atrasa.
  setInterval(() => {
    runRefresh().catch((err) => {
      console.error("[oidc-cron] error inesperado:", err);
    });
  }, REFRESH_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[oidc-cron] fatal:", err);
  process.exit(1);
});
