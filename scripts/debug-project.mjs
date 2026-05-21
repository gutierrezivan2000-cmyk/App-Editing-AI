// Quick debug helper: imprime un proyecto + los clips con sus tamanos.
// Uso: node scripts/debug-project.mjs <projectId>
import { sql } from "@vercel/postgres";
import fs from "node:fs";
import path from "node:path";

// Cargar .env.local como hace Next (no podemos importar @next/env aca).
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
  console.error("usage: node debug-project.mjs <projectId>");
  process.exit(1);
}

const { rows } = await sql`SELECT * FROM proyectos WHERE id = ${projectId}`;
if (rows.length === 0) {
  console.error("not found");
  process.exit(1);
}
const p = rows[0];
console.log("nombre:", p.nombre);
console.log("status:", p.status, "err:", p.error_message);
console.log("renderMethod:", p.render_method);
console.log("renderSubtitulos:", p.render_subtitulos);
console.log("updatedAt:", p.updated_at);
console.log("progress:", JSON.stringify(p.progress, null, 2));
console.log("outputUrl:", p.output_url);
console.log("xmlUrl:", p.xml_url);
console.log("edlUrl:", p.edl_url);
console.log("capcutUrl:", p.capcut_url);
console.log("srtUrl:", p.srt_url);
console.log("duracionSeg:", p.duracion_seg);
console.log("keepSegmentsCount:", p.keep_segments_count);
console.log("\nclips:");
const clips = p.clips ?? [];
let total = 0;
for (let i = 0; i < clips.length; i++) {
  const c = clips[i];
  console.log(`  [${i}] ${c.name} ${c.duracion?.toFixed?.(1) ?? "?"}s ${c.width}x${c.height}@${c.fps}fps`);
  console.log(`       url: ${c.url}`);
  // HEAD para obtener content-length
  try {
    const head = await fetch(c.url, { method: "HEAD" });
    const len = Number(head.headers.get("content-length") ?? 0);
    total += len;
    console.log(`       size: ${(len / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    console.log(`       size: HEAD failed (${err.message})`);
  }
}
console.log(`\nTOTAL clips: ${(total / 1024 / 1024).toFixed(1)} MB`);

if (p.plan_multiclip?.snippets) {
  console.log(`\nsnippets: ${p.plan_multiclip.snippets.length}`);
  const dur = p.plan_multiclip.snippets.reduce((a, s) => a + (s.end - s.start), 0);
  console.log(`duracion final: ${dur.toFixed(1)}s`);
}
