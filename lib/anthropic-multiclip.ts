import Anthropic from "@anthropic-ai/sdk";
import type {
  ClienteProfile,
  PlanMulticlip,
  SnippetPlan,
  WordTimestamp,
} from "@/types";

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
// 600 era muy chico — si un clip tiene >600 palabras (cualquier clip de
// 3-4 minutos), Claude solo veia el principio y omitia contenido. Subido
// a 3000 que cubre ~15 min de habla normal, suficiente para casi cualquier
// clip de reels/shorts en pieza fuente. El prompt sigue cabiendo bien en
// el contexto de Sonnet (200k tokens).
const MAX_WORDS_PER_CLIP = 3000;

type AnimacionSubtitulos = ClienteProfile["subtitulos"]["animacion"];
const ANIMACIONES: AnimacionSubtitulos[] = [
  "pop-scale",
  "slide-up",
  "typewriter",
  "highlight",
  "karaoke",
];

function isAnimacion(v: unknown): v is AnimacionSubtitulos {
  return typeof v === "string" && (ANIMACIONES as string[]).includes(v);
}

export interface MulticlipInputClip {
  /** índice 0-based del clip dentro del proyecto */
  index: number;
  /** filename — útil para que Claude pueda referenciarlo en explicaciones */
  name: string;
  /** duración del clip en segundos */
  duracion: number;
  /** transcripción palabra a palabra (relativa a este clip) */
  transcripcion: WordTimestamp[];
}

/**
 * Renderiza la transcripcion de un clip en un formato que Claude lee MUCHO
 * mejor que el JSON crudo:
 *
 *   [0.00-0.85]  "Hola"
 *   [0.85-1.40]  "amigos"
 *   [GAP 1.2s -- silencio]
 *   [2.60-3.10]  "como"
 *   [3.10-3.80]  "estan"
 *   ...
 *
 * Anotaciones explicitas que el modelo no tiene que inferir:
 *   - Cada palabra con su rango temporal
 *   - GAPS de mas de 0.3s entre palabras consecutivas (candidatos a cortar)
 *   - Marcadores [SILENCIO LARGO] para gaps > 1s (obligatorios a cortar)
 *
 * Asi Claude ve los silencios SIN tener que hacer aritmetica con JSON.
 */
function renderTranscripcion(words: WordTimestamp[]): string {
  if (words.length === 0) return "(clip sin transcripcion — solo silencio o sin audio)";
  const lines: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    lines.push(`  [${w.start.toFixed(2)}-${w.end.toFixed(2)}] "${w.texto}"`);
    if (i + 1 < words.length) {
      const gap = words[i + 1].start - w.end;
      if (gap >= 1.0) {
        lines.push(`  >>> SILENCIO LARGO ${gap.toFixed(2)}s — CORTAR AQUI <<<`);
      } else if (gap >= 0.4) {
        lines.push(`  >>> pausa ${gap.toFixed(2)}s — cortar si no aporta <<<`);
      } else if (gap >= 0.25) {
        lines.push(`  (respiracion ${gap.toFixed(2)}s — mantener)`);
      }
    }
  }
  return lines.join("\n");
}

export function buildMulticlipPrompt(
  clips: MulticlipInputClip[],
  brief: string,
  guion: string | null,
  animacionDefault: AnimacionSubtitulos
): string {
  const clipsBlock = clips
    .map((c) => {
      const truncated = c.transcripcion.length > MAX_WORDS_PER_CLIP;
      const sample = c.transcripcion.slice(0, MAX_WORDS_PER_CLIP);
      // Texto plano concatenado — ayuda a Claude a entender el discurso
      // como un todo antes de meterse en los timestamps.
      const textoPlano = sample.map((w) => w.texto).join(" ");
      return `### Clip ${c.index} — "${c.name}" (duracion ${c.duracion.toFixed(2)}s)${
        truncated ? ` — mostrando primeras ${MAX_WORDS_PER_CLIP} de ${c.transcripcion.length} palabras` : ""
      }

TRANSCRIPCION PLANA del clip ${c.index}:
"${textoPlano}"

PALABRAS CON TIMESTAMPS Y GAPS:
${renderTranscripcion(sample)}`;
    })
    .join("\n\n");

  const guionBlock = guion
    ? `\nGUIÓN (texto exacto que debe quedar — matchea cada línea con un tramo de algún clip):
${guion}
`
    : "\n(SIN GUIÓN — usa el orden actual de los clips. Solo limpia silencios, errores y repeticiones dentro de cada clip.)\n";

  return `Eres un editor profesional de Reels/TikToks/Shorts con 10 anos de experiencia. Tu cliente subio ${clips.length} clip(s) crudos. Tu trabajo: producir un video FINAL coherente, rapido, sin aire muerto.

PROCESO DE PENSAMIENTO QUE TIENES QUE SEGUIR ANTES DE RESPONDER:
1. Lee la TRANSCRIPCION PLANA de cada clip — entiende el discurso completo.
2. Mira las anotaciones "SILENCIO LARGO" / "pausa" en cada clip — esos son tus puntos de corte naturales.
3. Identifica REPETICIONES de ideas (no de palabras exactas — IDEAS). Si la persona dice "este metodo funciona muy bien" en el clip 0 y luego "esto realmente funciona" en el clip 2, son la misma idea: quedate con UNA.
4. Identifica AUTOCORRECCIONES: "este... a ver, perdon, este otro" — descarta la version incorrecta + la palabra de correccion.
5. Decide el ORDEN final que tenga sentido narrativo (intro → desarrollo → cierre/CTA).
6. Para cada snippet [start, end], usa los timestamps DEL EXACTO inicio de la primera palabra y fin de la ultima palabra que quieres incluir (+0.05s al end para no cortar la consonante).

REGLAS ESTRICTAS:

A) SILENCIOS Y PAUSAS — LA MAS IMPORTANTE:
   - Cada gap marcado ">>> SILENCIO LARGO <<<" DEBE ser cortado: termina un snippet antes del silencio, empieza otro despues.
   - Cada gap marcado ">>> pausa <<<" — corta si no aporta dramatica. Por defecto SI cortar.
   - Los gaps "(respiracion)" se mantienen — son naturales.
   - NUNCA dejes que un snippet contenga un SILENCIO LARGO interno. Si lo hace, partelo en dos snippets.

B) REPETICIONES DE IDEAS (no de palabras exactas):
   - Si la persona da el mismo mensaje dos veces (aunque con palabras distintas) → SOLO USA UNA.
   - Si hay dos tomas de la misma idea (Toma A en clip 0, Toma B en clip 1) → escoge la mas fluida.
   - Una idea por video = una sola aparicion. NO toleres redundancia.

C) AUTOCORRECCIONES Y ERRORES:
   - "perdon", "a ver", "espera", "ay no", "asi no", "dejame", "como decia" + version incorrecta previa → CORTAR esos.
   - Quedate solo con la version final/correcta.

D) MULETILLAS:
   - "eh", "este", "o sea", "como que", "tipo", "sabes", "no?" usados de relleno → corta cuando sobran.
   - Una muletilla aislada esta bien. Tres seguidas no.

E) FRAGMENTOS INCOMPLETOS:
   - Si un snippet empieza a media oracion sin contexto previo → reconsidera.
   - Si termina sin cerrar la idea → extiende hasta cerrar o no lo uses.

F) GRANULARIDAD DE CORTES:
   - NUNCA cortes una palabra a la mitad. Usa los timestamps de palabra entera.
   - start = exactamente el "start" de la primera palabra a incluir.
   - end = "end" de la ultima palabra + 0.05s (para no cortar consonantes).
   - Duracion minima de un snippet: 0.4s. Mas corto que eso es discontinuo y mal.

G) ORDEN NARRATIVO:
   - Si HAY GUION: respeta el orden del guion. Cada linea del guion = uno o mas snippets contiguos. Anota guionLineIndex.
   - Si NO HAY GUION: empieza con el mejor HOOK (impacto, pregunta, dato), desarrolla, cierra con CTA o conclusion. NO necesariamente sigue el orden de los clips crudos.

H) COHERENCIA ENTRE SNIPPETS:
   - El video final se forma concatenando los snippets EN EL ORDEN QUE DEVUELVAS. Tu trabajo es asegurar que el resultado FLUYA semanticamente.
   - Antes de cerrar, lee mentalmente la concatenacion de todos los snippets como una sola oracion. Si suena raro, reordena.

DURACION OBJETIVO:
- Reels/Shorts: 20-90 segundos finales.
- Si el material es 5+ minutos → quedate con el 15-30% que mas vale.
- Mejor 30s perfectos que 90s con relleno.

BRIEF DEL CLIENTE:
${brief}
${guionBlock}
TRANSCRIPCIONES POR CLIP (cada palabra trae sus timestamps en segundos, relativos al inicio del clip):

${clipsBlock}

ADEMÁS, devuelvé:
- "enfasisPalabras" (5–15 palabras, lowercase, sin puntuación): las que se resaltan visualmente en los subtítulos. Elegí CIFRAS, CTAs, palabras clave del brief, conceptos diferenciadores.
- "animacionOverride": si la animación default ("${animacionDefault}") no encaja con el tono del brief, sugerí otra (pop-scale, slide-up, typewriter, highlight, karaoke). Si está bien, null.
- "observaciones": 1-2 frases — qué cortaste y por qué (ayuda al humano a confiar en tu decisión).

———————————
RESPONDE ÚNICAMENTE CON JSON VÁLIDO. Sin markdown, sin texto fuera del JSON:
{
  "snippets": [
    { "clipIndex": 0, "start": 1.2, "end": 8.7, "guionLineIndex": 0, "razon": "hook del producto, mejor toma" },
    { "clipIndex": 0, "start": 12.4, "end": 18.9, "guionLineIndex": null, "razon": "explicación del beneficio (saltée silencio de 1.5s en seg 9-12)" },
    { "clipIndex": 2, "start": 0.4, "end": 12.5, "guionLineIndex": 1, "razon": "cierre + CTA, descarté la primera toma porque titubeaba" }
  ],
  "enfasisPalabras": ["resultado", "garantía", "hoy", "gratis"],
  "animacionOverride": null,
  "observaciones": "Descarté repetición del clip 1 (idéntica a clip 0 seg 5-9) y la corrección 'perdón a ver' en clip 2 seg 3-5."
}`;
}

/**
 * Padding al inicio y fin de cada snippet en segundos.
 * START_PAD: cuanto retroceder el inicio del snippet desde el "start" de
 *   la primera palabra. Evita cortar el ataque consonante inicial.
 * END_PAD: cuanto avanzar el fin del snippet desde el "end" de la ultima
 *   palabra. Evita cortar la consonante final (p, t, k, s).
 */
const START_PAD_SEC = 0.06;
const END_PAD_SEC = 0.12;
/** Gap maximo entre dos snippets contiguos del mismo clip para fusionarlos. */
const MERGE_GAP_SEC = 0.25;

/**
 * Ajusta un snippet a boundaries de palabras reales en la transcripcion.
 *
 * Claude devuelve start/end como numeros "limpios" (1.2, 8.7) pero las
 * palabras reales empiezan/terminan en valores arbitrarios (1.18, 8.74).
 * Si dejamos pasar el end de Claude (8.7), ffmpeg corta la ultima palabra
 * porque su end real era 8.74. Resultado: consonante final cortada, suena
 * mal.
 *
 * Estrategia:
 *   1. Encontrar la PRIMERA palabra cuyo start sea >= snippet.start - 0.1s.
 *      Esa es la primera palabra a incluir. Tomamos su start como nuevo
 *      start (- START_PAD).
 *   2. Encontrar la ULTIMA palabra cuyo end sea <= snippet.end + 0.1s.
 *      Esa es la ultima palabra a incluir. Tomamos su end como nuevo end
 *      (+ END_PAD).
 *   3. Si no hay palabras dentro del rango, devolvemos null (snippet
 *      invalido — Claude apunto a un silencio).
 */
function snapToWords(
  snippetStart: number,
  snippetEnd: number,
  words: WordTimestamp[]
): { start: number; end: number } | null {
  if (words.length === 0) return null;
  // Tolerancia de 100ms para palabras "casi adentro" del rango propuesto.
  const tolerance = 0.1;
  const wordsInRange = words.filter(
    (w) => w.end > snippetStart - tolerance && w.start < snippetEnd + tolerance
  );
  if (wordsInRange.length === 0) return null;
  const firstWord = wordsInRange[0];
  const lastWord = wordsInRange[wordsInRange.length - 1];
  return {
    start: Math.max(0, firstWord.start - START_PAD_SEC),
    end: lastWord.end + END_PAD_SEC,
  };
}

/**
 * Si dos snippets consecutivos pertenecen al MISMO clip y el gap entre
 * ellos es < MERGE_GAP_SEC, los fusionamos. Evita que ffmpeg haga 2 cortes
 * separados con un pedacito de silencio entre medio (lo cual suena seco).
 */
function mergeContiguousSnippets(snippets: SnippetPlan[]): SnippetPlan[] {
  if (snippets.length <= 1) return snippets;
  const merged: SnippetPlan[] = [snippets[0]];
  for (let i = 1; i < snippets.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = snippets[i];
    const sameClip = curr.clipIndex === prev.clipIndex;
    const closeEnough = curr.start - prev.end < MERGE_GAP_SEC;
    const sameContinuity =
      curr.start >= prev.end - 0.05; // no overlap fuerte ni "vuelta atras"
    if (sameClip && closeEnough && sameContinuity) {
      merged[merged.length - 1] = {
        ...prev,
        end: Math.max(prev.end, curr.end),
        // Preserva razon del primero; agrega la del segundo si trae info.
        razon:
          prev.razon && curr.razon && prev.razon !== curr.razon
            ? `${prev.razon} + ${curr.razon}`
            : (prev.razon ?? curr.razon),
      };
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function normalizeSnippets(
  raw: unknown,
  clips: MulticlipInputClip[]
): SnippetPlan[] {
  if (!Array.isArray(raw)) return [];
  const valid: SnippetPlan[] = [];
  const byIndex = new Map(clips.map((c) => [c.index, c]));
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const clipIndex = Number(o.clipIndex);
    const start = Number(o.start);
    const end = Number(o.end);
    if (!Number.isInteger(clipIndex)) continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= start) continue;
    const clip = byIndex.get(clipIndex);
    if (!clip) continue;

    // Snap a boundaries de palabras reales — evita cortes a media palabra.
    const snapped = snapToWords(start, end, clip.transcripcion);
    if (!snapped) continue;

    // Clamp a duracion del clip.
    const clampedStart = Math.max(0, Math.min(snapped.start, clip.duracion));
    const clampedEnd = Math.max(0, Math.min(snapped.end, clip.duracion));
    if (clampedEnd <= clampedStart) continue;
    // Duracion minima 0.3s — mas corto suena entrecortado.
    if (clampedEnd - clampedStart < 0.3) continue;

    const guionLineIndex =
      o.guionLineIndex !== undefined && o.guionLineIndex !== null
        ? Number(o.guionLineIndex)
        : undefined;
    const razon = typeof o.razon === "string" ? o.razon : undefined;
    valid.push({
      clipIndex,
      start: clampedStart,
      end: clampedEnd,
      guionLineIndex: Number.isInteger(guionLineIndex) ? guionLineIndex : undefined,
      razon,
    });
  }
  // Pass final: fusionar snippets contiguos del mismo clip con gap pequeno.
  return mergeContiguousSnippets(valid);
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

export async function planificarMulticlipConClaude(
  clips: MulticlipInputClip[],
  brief: string,
  guion: string | null,
  animacionDefault: AnimacionSubtitulos
): Promise<PlanMulticlip> {
  const prompt = buildMulticlipPrompt(clips, brief, guion, animacionDefault);

  const message = await getAnthropic().messages.create({
    model: MODEL,
    // 32k da espacio para que Claude razone explicitamente (modo "scratch
    // pad" antes del JSON final). Sonnet 4.5 soporta hasta 64k output.
    max_tokens: 32_000,
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
  if (!match) throw new Error("Claude no devolvió JSON parseable");

  let parsed: {
    snippets?: unknown;
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

  const snippets = normalizeSnippets(parsed.snippets, clips);
  if (snippets.length === 0) {
    throw new Error("Claude no devolvió snippets utilizables");
  }
  const enfasisPalabras = normalizeEnfasis(parsed.enfasisPalabras);
  const animacionOverride = isAnimacion(parsed.animacionOverride)
    ? parsed.animacionOverride
    : null;
  const observaciones =
    typeof parsed.observaciones === "string" ? parsed.observaciones : "";

  return { snippets, enfasisPalabras, animacionOverride, observaciones };
}
