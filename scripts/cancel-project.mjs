// Marca un proyecto como cancelado (status=error + errorMessage="Cancelado...").
// Inngest no detiene el job activo pero el updateProject del final no lo
// sobrescribe porque el codigo respeta "Cancelado..." (ver lib/db.ts).
//
// Uso: node scripts/cancel-project.mjs <projectId>
import { sql } from "@vercel/postgres";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..", ".env.local");
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
  console.error("usage: node cancel-project.mjs <projectId>");
  process.exit(1);
}

const { rows } = await sql`
  UPDATE proyectos
  SET status = 'error',
      error_message = 'Cancelado por el usuario (timeout debug)',
      updated_at = NOW()
  WHERE id = ${projectId}
  RETURNING id, status, error_message
`;
console.log(JSON.stringify(rows[0], null, 2));
