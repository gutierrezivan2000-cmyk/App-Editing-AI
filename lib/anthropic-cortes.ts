import Anthropic from "@anthropic-ai/sdk";
import type { ClienteProfile, SilenceSegment, WordTimestamp } from "@/types";

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY no está configurada en el environment del servidor"
    );
  }
  return new Anthropic({ apiKey, timeout: 270_000 });
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

type AnimacionSubtitulos = ClienteProfile["subtitulos"]["animacion"];
const ANIMACIONES_VALIDAS: AnimacionSubtitulos[] = [
  "pop-scale",
  "slide-up",
  "typewriter",
  "highlight",
  "karaoke",
];

function isAnimacion(v: unknown): v is AnimacionSubtitulos {
  return typeof v === "string" && (ANIMACIONES_VALIDAS as string[]).includes(v);
}

export type CorteRazon =
  | "silencio"
  | "error"
  | "repeticion"
  | "muletilla"
  | "off-topic"
  | "otro";

export interface CorteIA {
  start: number;
  end: number;
  razon: CorteRazon;
  explicacion: string;
}

export interface AnalisisCortes {
  cortes: CorteIA[];
  enfasisPalabras: string[];
  animacionOverride: AnimacionSubtitulos | null;
  observaciones: string;
}

const MAX_WORDS_IN_PROMPT = 1200;

export function buildCortesPrompt(
  transcripcion: WordTimestamp[],
  silencios: SilenceSegment[],
  brief: string,
  duracionTotal: number,
  animacionDefault: AnimacionSubtitulos
): string {
  const words = transcripcion.slice(0, MAX_WORDS_IN_PROMPT);
  const truncated =
    transcripcion.length > MAX_WORDS_IN_PROMPT
      ? ` (primeras ${MAX_WORDS_IN_PROMPT} de ${transcripcion.length})`
      : "";

  return `Eres un editor experto que limpia transcripciones de video y dirige sus subtítulos dinámicos. Vas a recibir la transcripción palabra a palabra (con timestamps), los silencios detectados y un brief. Tienes que devolver TRES cosas:

A) Qué trozos de tiempo CORTAR del video.
B) Qué palabras MARCAR como énfasis para que se rendericen más grandes / con color destacado en los subtítulos.
C) Opcionalmente, qué animación de subtítulos usar (sobreescribiendo la default del cliente).

———————————
A) CORTES — criterios en orden de prioridad:
1. ERROR/CORRECCIÓN: la persona dice algo, se equivoca, lo corrige y vuelve a decirlo bien. Cortar la versión incorrecta + el "perdón", "ay no", etc.
2. REPETICIÓN: dice una misma frase dos veces seguidas. Mantener una de las dos (la mejor) y cortar la otra.
3. MULETILLAS EXCESIVAS: "eh", "este", "o sea", "ehmm", "verdad" cuando son repetitivos. NO cortar las primeras (sonarían cortadas), solo las que sobran.
4. SILENCIO LARGO: pausa sin habla > 0.6 s entre palabras. Conservar un margen de 0.1 s antes y después (esto te lo doy ya en la lista de silencios).
5. OFF-TOPIC: la persona se desvía del brief de forma evidente y luego retoma. Cortar el desvío.

REGLAS DURAS PARA CORTES:
- NUNCA cortes más allá del rango [0, ${duracionTotal.toFixed(2)}] segundos.
- NUNCA solapes rangos. Si dos cortes se tocan, fusionalos.
- Cortes pequeños (< 0.15 s) ignóralos: no aportan y dejan corte audible.
- Si dudas, NO CORTES. Es peor cortar bien dicho que conservar un titubeo.
- Devuelve los cortes ordenados por start ascendente.

———————————
B) PALABRAS DE ÉNFASIS:
- 5–15 palabras únicas (lowercase, sin puntuación) que destacarías visualmente: cifras, CTAs, palabras clave del brief, conceptos centrales.
- Evita conectores (de, la, el, en, que, y…) y verbos genéricos (es, está…).
- No marques palabras que cayeran dentro de tus cortes.

———————————
C) ANIMACIÓN:
- "${animacionDefault}" es el default del cliente. Solo cambia si hay una razón fuerte (formato corto y muy enfático → "pop-scale"; vídeo educativo lento → "slide-up"; lectura literal → "typewriter"; landing/promo → "highlight"; música/coros → "karaoke").
- Si la default está bien, devuelve null.

———————————
BRIEF:
${brief}

DURACIÓN TOTAL: ${duracionTotal.toFixed(2)} s

SILENCIOS DETECTADOS POR FFMPEG (${silencios.length}):
${JSON.stringify(silencios.slice(0, 200))}

TRANSCRIPCIÓN${truncated}:
${JSON.stringify(words)}

———————————
RESPONDE ÚNICAMENTE CON JSON VÁLIDO. Sin markdown, sin comentarios fuera del JSON:
{
  "cortes": [
    { "start": 0.0, "end": 0.5, "razon": "silencio", "explicacion": "pausa larga al inicio" },
    { "start": 12.4, "end": 14.1, "razon": "error", "explicacion": "tropezón seguido de re-toma" }
  ],
  "enfasisPalabras": ["mil", "dólares", "ahora"],
  "animacionOverride": null,
  "observaciones": "string corta — qué hiciste y qué dejaste pasar"
}`;
}

function isCorteRazon(v: unknown): v is CorteRazon {
  return (
    v === "silencio" ||
    v === "error" ||
    v === "repeticion" ||
    v === "muletilla" ||
    v === "off-topic" ||
    v === "otro"
  );
}

function normalizeCortes(
  raw: unknown,
  duracionTotal: number
): CorteIA[] {
  if (!Array.isArray(raw)) return [];
  const valid: CorteIA[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const start = Number(o.start);
    const end = Number(o.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= start) continue;
    if (end - start < 0.15) continue;
    const clampedStart = Math.max(0, Math.min(start, duracionTotal));
    const clampedEnd = Math.max(0, Math.min(end, duracionTotal));
    if (clampedEnd <= clampedStart) continue;
    const razon = isCorteRazon(o.razon) ? o.razon : "otro";
    const explicacion =
      typeof o.explicacion === "string" ? o.explicacion : "";
    valid.push({
      start: clampedStart,
      end: clampedEnd,
      razon,
      explicacion,
    });
  }
  // Sort by start, then merge overlaps
  valid.sort((a, b) => a.start - b.start);
  const merged: CorteIA[] = [];
  for (const c of valid) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) {
      last.end = Math.max(last.end, c.end);
      if (last.razon !== c.razon) {
        last.explicacion = `${last.explicacion} + ${c.explicacion}`.slice(0, 200);
      }
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}

function normalizeEnfasis(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) =>
      v
        .toLowerCase()
        .replace(/[.,!?¿¡:;"'()¡¿]/g, "")
        .trim()
    )
    .filter((v) => v.length > 0 && v.length < 40);
  return Array.from(new Set(cleaned)).slice(0, 25);
}

export async function analizarCortesConClaude(
  transcripcion: WordTimestamp[],
  silencios: SilenceSegment[],
  brief: string,
  duracionTotal: number,
  animacionDefault: AnimacionSubtitulos
): Promise<AnalisisCortes> {
  const prompt = buildCortesPrompt(
    transcripcion,
    silencios,
    brief,
    duracionTotal,
    animacionDefault
  );

  const message = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") {
    throw new Error("Respuesta inesperada de Claude (no es texto)");
  }

  const cleaned = block.text
    .replace(/```json\s*/g, "")
    .replace(/```\s*$/g, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Claude no devolvió JSON parseable");
  }

  let parsed: {
    cortes?: unknown;
    enfasisPalabras?: unknown;
    animacionOverride?: unknown;
    observaciones?: unknown;
  };
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`JSON inválido en respuesta de Claude: ${msg}`);
  }

  const cortes = normalizeCortes(parsed.cortes, duracionTotal);
  const enfasisPalabras = normalizeEnfasis(parsed.enfasisPalabras);
  const animacionOverride = isAnimacion(parsed.animacionOverride)
    ? parsed.animacionOverride
    : null;
  const observaciones =
    typeof parsed.observaciones === "string" ? parsed.observaciones : "";

  return { cortes, enfasisPalabras, animacionOverride, observaciones };
}
