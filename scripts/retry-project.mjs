// Reintento manual de un proyecto multiclip: limpia estado de error,
// pre-setea incluir_clips_en_zip=false, y encola el evento Inngest.
//
// Uso: node scripts/retry-project.mjs <projectId>
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
  console.error("usage: node retry-project.mjs <projectId>");
  process.exit(1);
}

// 1. Reset estado
const { rows } = await sql`
  UPDATE proyectos
  SET status = 'pending',
      error_message = NULL,
      progress = NULL,
      incluir_clips_en_zip = false,
      updated_at = NOW()
  WHERE id = ${projectId}
  RETURNING id, status, render_method, render_subtitulos, incluir_clips_en_zip
`;
if (rows.length === 0) {
  console.error("not found");
  process.exit(1);
}
console.log("RESET:", JSON.stringify(rows[0], null, 2));

// 2. Encolar evento Inngest. Usamos el endpoint /e/ del dev server
//    (puerto 8288) que es el inlet de eventos para apps locales.
const eventKey = process.env.INNGEST_EVENT_KEY ?? "abc";
const payload = {
  name:
    rows[0].render_method === "multiclip"
      ? "pipeline/multiclip-run"
      : rows[0].render_method === "cortes"
        ? "pipeline/cortes-run"
        : "pipeline/run",
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
