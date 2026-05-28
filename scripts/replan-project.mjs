// Re-ejecuta el step "Plan Claude" del pipeline multiclip de un proyecto
// existente, sin re-correr analyze-clips ni transcribe-clips. Util para
// validar mejoras al prompt o a las heuristicas del planning contra
// proyectos que ya estan procesados.
//
// Uso: node scripts/replan-project.mjs <projectId>
import { sql } from "@vercel/postgres";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(
  path.dirname(new URL(import.meta.url).pathname.slice(1)),
  "..",
  ".env.local",
);
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let val = m[2];
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  process.env[m[1]] ??= val;
}

const projectId = process.argv[2];
if (!projectId) {
  console.error("usage: node replan-project.mjs <projectId>");
  process.exit(1);
}

// Verifica el proyecto + reset status.
const { rows } = await sql`
  UPDATE proyectos
  SET status = 'processing',
      error_message = NULL,
      progress = NULL,
      updated_at = NOW()
  WHERE id = ${projectId}
  RETURNING id, status, render_method, render_subtitulos
`;
if (rows.length === 0) {
  console.error("not found");
  process.exit(1);
}
if (rows[0].render_method !== "multiclip") {
  console.error(`render_method != multiclip (got: ${rows[0].render_method})`);
  process.exit(1);
}
console.log("RESET:", JSON.stringify(rows[0], null, 2));

// Encolar el evento Inngest.
const eventKey = process.env.INNGEST_EVENT_KEY ?? "abc";
const payload = {
  name: "pipeline/multiclip-replan",
  data: { projectId },
};
const res = await fetch(`http://localhost:8288/e/${eventKey}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.error("inngest send failed:", res.status, await res.text());
  process.exit(1);
}
console.log("ENQUEUED:", payload.name, "for", projectId);
console.log("Mira el progreso en /dashboard/proyectos/" + projectId);
