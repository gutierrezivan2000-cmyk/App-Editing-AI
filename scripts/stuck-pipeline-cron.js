// Watchdog server-side de pipelines estancados.
//
// Problema: si el sandbox muere a mitad de un step (OOM, OIDC expirado,
// network glitch), Inngest reintenta segun `retries: 2`. Cada retry puede
// durar 10+ min, asi que el usuario puede ver "Processing" durante 45 min
// antes de que Inngest llame el catch global y marque error.
//
// Este daemon corre como proceso PM2 al lado de los otros. Cada 2 min
// consulta DB y busca proyectos:
//   - status = 'processing'
//   - updated_at < NOW() - INACTIVE_THRESHOLD_MIN
//
// Los marca como 'error' con mensaje claro. El usuario ve el error en el
// proximo poll (~1.5s) y puede reintentar.
//
// La columna `updated_at` se actualiza:
//   - cuando Inngest hace updateProject() entre steps
//   - cuando el pipeline reporta progress
//   - cuando un step largo (render Remotion) corre startHeartbeat() cada 30s
//
// Si `updated_at` no cambia en 8 minutos, asumimos que el step esta muerto.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

const { sql } = require("@vercel/postgres");

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 min
const INACTIVE_THRESHOLD_MIN = 8; // 8 min sin updates -> matar
// El mensaje exacto facilita que la UI lo identifique y muestre el
// banner amber de "estancado" (similar a "Cancelado por el usuario").
const STUCK_MARKER = "Pipeline sin actividad — posible sandbox caído";

async function sweepStuckPipelines() {
  const ts = new Date().toISOString();
  try {
    // Buscar proyectos activos sin actividad reciente.
    const { rows } = await sql`
      SELECT id, nombre, render_method, updated_at
      FROM proyectos
      WHERE status = 'processing'
        AND updated_at < NOW() - (${INACTIVE_THRESHOLD_MIN}::int * INTERVAL '1 minute')
    `;
    if (rows.length === 0) {
      // No log — el caso comun es no hacer nada. Evita ruido.
      return;
    }
    console.log(`[stuck-cron] ${ts} encontre ${rows.length} pipeline(s) estancado(s)`);
    for (const row of rows) {
      const lastUpdate = new Date(row.updated_at);
      const minutesAgo = Math.floor(
        (Date.now() - lastUpdate.getTime()) / 1000 / 60
      );
      console.log(
        `[stuck-cron] ${ts} matando proyecto ${row.id} (${row.nombre}, ${row.render_method}) — sin updates hace ${minutesAgo} min`,
      );
      // Marcar como error. NO sobrescribir si ya tiene un error message
      // (puede ser una cancelacion en flight). UPDATE condicional.
      await sql`
        UPDATE proyectos
        SET status = 'error',
            error_message = ${STUCK_MARKER},
            updated_at = NOW()
        WHERE id = ${row.id}
          AND status = 'processing'
          AND (error_message IS NULL OR error_message NOT LIKE 'Cancelado%')
      `;
    }
  } catch (err) {
    console.error(`[stuck-cron] ${ts} error en sweep:`, err.message ?? err);
  }
}

async function main() {
  console.log(
    `[stuck-cron] daemon iniciado — chequeo cada ${CHECK_INTERVAL_MS / 1000}s, umbral ${INACTIVE_THRESHOLD_MIN}min`,
  );
  await sweepStuckPipelines();
  setInterval(() => {
    sweepStuckPipelines().catch((err) =>
      console.error("[stuck-cron] error inesperado:", err),
    );
  }, CHECK_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[stuck-cron] fatal:", err);
  process.exit(1);
});
