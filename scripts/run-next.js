// Wrapper para arrancar `next dev` desde PM2 sin que aparezcan ventanas de
// consola en Windows.
//
// Problema: PM2 (ForkMode) spawnea `node next dev` sin la flag `windowsHide`.
// El proceso master "next" sí termina sin ventana, pero Next.js internamente
// forkea un worker llamado `next-server` que SÍ abre una consola visible
// (titulada "next-server (vX.Y.Z)") porque hereda el comportamiento de spawn
// del padre.
//
// Solución: este wrapper hace el spawn manualmente con:
//   - `windowsHide: true`           -> no abrir consola en Windows
//   - `stdio: "inherit"`            -> logs siguen yendo a los pipes de PM2
// Con `windowsHide` el primer node hijo arranca SIN consola. Como los forks
// posteriores en Windows heredan "no console" del padre, ningún subproceso
// posterior puede abrir ventana.
//
// Además forwardea SIGINT/SIGTERM al hijo para que `pm2 stop` y `pm2 restart`
// terminen el proceso limpiamente.

const { spawn } = require("child_process");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

// Limpieza de env vars VACIAS heredadas del shell. Next.js carga .env.local
// solo para variables que NO existen en process.env. Si la shell del usuario
// tiene `ANTHROPIC_API_KEY=""` (string vacia) — algo comun en sesiones de
// Claude Code o despues de hacer `set ANTHROPIC_API_KEY=` en cmd — Next ve
// la variable "existente" (aunque vacia) y NO la sobreescribe con .env.local.
// Resultado: el cliente Anthropic recibe "" y tira "no esta configurada".
//
// Solucion: borrar la variable del env del proceso si esta vacia, ANTES de
// spawnar next. Asi Next.js encuentra "no existe" y SI carga la del archivo.
const SENSITIVES_TO_CLEAN = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AUTH_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "MIRAGE_API_KEY",
  "MIRAGE_CAPTION_TEMPLATE_ID",
  "CLICKUP_WEBHOOK_SECRET",
];
const cleanEnv = { ...process.env };
for (const key of SENSITIVES_TO_CLEAN) {
  if (cleanEnv[key] !== undefined && cleanEnv[key].length === 0) {
    delete cleanEnv[key];
  }
}

const child = spawn(process.execPath, [nextBin, "dev"], {
  cwd: projectRoot,
  env: cleanEnv,
  stdio: "inherit",
  windowsHide: true,
});

const forward = (sig) => {
  if (!child.killed) child.kill(sig);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

child.on("error", (err) => {
  console.error("[run-next] spawn error:", err);
  process.exit(1);
});
