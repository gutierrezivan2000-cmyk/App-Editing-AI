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
 * Renderiza la transcripcion de un clip con ÍNDICES EXPLICITOS por palabra
 * para que Claude pueda elegir por índice y no inventar timestamps:
 *
 *   [W0   0.00-0.85]  "Hola"
 *   [W1   0.85-1.40]  "amigos"
 *   >>> SILENCIO LARGO 1.20s — corte obligatorio entre W1 y W2 <<<
 *   [W2   2.60-3.10]  "como"
 *   [W3   3.10-3.80]  "estan"
 *   ...
 *
 * Claude responde `{ firstWordIdx, lastWordIdx }` y nosotros derivamos los
 * timestamps reales mirando la transcripcion. Esto elimina por construccion
 * los cortes a mitad de palabra y los desfases.
 *
 * Anotaciones explicitas que el modelo no tiene que inferir:
 *   - Cada palabra con su índice y su rango temporal
 *   - GAPS de mas de 0.3s entre palabras consecutivas (candidatos a cortar)
 *   - Marcadores SILENCIO LARGO para gaps > 1s (obligatorios a cortar)
 */
function renderTranscripcion(words: WordTimestamp[]): string {
  if (words.length === 0) return "(clip sin transcripcion — solo silencio o sin audio)";
  // Padding del indice (W0001, W0023) para que se alineen visualmente.
  const idxWidth = String(words.length - 1).length;
  const pad = (i: number) => String(i).padStart(idxWidth, "0");
  const lines: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    lines.push(
      `  [W${pad(i)}  ${w.start.toFixed(2)}-${w.end.toFixed(2)}]  "${w.texto}"`,
    );
    if (i + 1 < words.length) {
      const gap = words[i + 1].start - w.end;
      if (gap >= 1.0) {
        lines.push(
          `  >>> SILENCIO LARGO ${gap.toFixed(2)}s entre W${pad(i)} y W${pad(i + 1)} — CORTE OBLIGATORIO <<<`,
        );
      } else if (gap >= 0.4) {
        lines.push(
          `  >>> pausa ${gap.toFixed(2)}s entre W${pad(i)} y W${pad(i + 1)} — cortar si no aporta <<<`,
        );
      } else if (gap >= 0.25) {
        lines.push(`  (respiracion ${gap.toFixed(2)}s)`);
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

  return `Sos editor profesional senior de Reels/TikToks/Shorts (10+ años). Tu cliente subió ${clips.length} clip(s) crudos. Tu trabajo: producir un video FINAL impecable, sin silencios, sin repeticiones, sin errores, sin aire muerto.

═══════════════════════════════════════════════════════════════
SISTEMA DE SELECCIÓN POR ÍNDICES DE PALABRA
═══════════════════════════════════════════════════════════════
Cada palabra de cada clip viene numerada como W0000, W0001, W0002, ...
Vos NO devolvés timestamps en segundos. Devolvés ÍNDICES de palabras:
  { "clipIndex": 0, "firstWordIdx": 5, "lastWordIdx": 23 }

Eso significa: del clip 0, incluí desde la palabra W0005 hasta la W0023
(ambas inclusive). El sistema deriva los segundos de los timestamps
reales de Whisper — vos NO podés inventar segundos que no sean de una
palabra entera.

═══════════════════════════════════════════════════════════════
PROCESO MENTAL OBLIGATORIO ANTES DE RESPONDER
═══════════════════════════════════════════════════════════════

PASO 1 — LEER LAS TRANSCRIPCIONES COMPLETAS:
Leé la transcripcion plana de TODOS los clips primero. No saltees.
Entendé el discurso completo antes de elegir nada.

PASO 2 — ENUMERAR LAS IDEAS NUCLEARES:
Hacé una lista mental de las 3-8 IDEAS NUCLEARES que el video debe
transmitir. Una idea = un concepto único, no una frase. Ejemplo:
   Idea 1: hook ("¿sabías que el 80% de los reels fallan por X?")
   Idea 2: problema concreto
   Idea 3: solución
   Idea 4: prueba social
   Idea 5: CTA

PASO 3 — PARA CADA IDEA, ELEGÍ LA MEJOR TOMA:
Para cada idea, buscá en los clips dónde la persona la dice de la
manera MÁS FLUIDA (sin tropezones, sin titubeos, con la inflexión más
natural). Si la idea aparece en 2 clips, elegí UNO solo (el mejor).

PASO 4 — DEFINIR LOS ÍNDICES DE PALABRA:
Para cada idea elegida, identificá el firstWordIdx y lastWordIdx
EXACTOS en su clip. La primera palabra debe ser el principio limpio
del pensamiento; la última debe cerrar el pensamiento.

PASO 5 — VERIFICAR LA CONCATENACIÓN:
Leé mentalmente los textos de los snippets en orden, uno detrás del
otro, como si fueran un solo discurso. Si suena entrecortado o salta
sin sentido, reordená.

═══════════════════════════════════════════════════════════════
REGLAS ESTRICTAS — NO NEGOCIABLES
═══════════════════════════════════════════════════════════════

【A】 SILENCIOS — la regla más importante:
• Cada bloque ">>> SILENCIO LARGO ... CORTE OBLIGATORIO <<<" DEBE
  ser un punto de corte. Terminás un snippet ANTES del silencio
  (lastWordIdx = el W de antes) y, si querés conservar lo de después,
  arrancás OTRO snippet con firstWordIdx = el W de después.
• NUNCA un snippet puede atravesar un "SILENCIO LARGO" interno.
  El sistema valida esto y va a partirlo automáticamente si lo violás.

【B】 REPETICIONES — política "una idea, una vez":
• Si la persona dice la misma IDEA dos o más veces (en el mismo
  clip o en clips distintos), elegí solo UNA aparición — la mejor.
• "Misma idea" = mismo concepto, aunque las palabras sean distintas.
  Ejemplo: "esto funciona muy bien" y "esto realmente funciona genial"
  son la misma idea. Quedate con una.
• Las repeticiones son la causa #1 de videos que se sienten amateur.
  Eliminalas SIN piedad.

【C】 ERRORES Y AUTOCORRECCIONES — palabras-señal:
Si encontrás cualquiera de estas, casi seguro hay una autocorrección
o error que debés CORTAR (el snippet termina antes y arranca uno
nuevo después, omitiendo el error):
   "perdón", "perdoname", "a ver", "espera", "esperá", "ay no",
   "así no", "no, así no", "dejame", "como decía", "déjame",
   "espera, no", "pará, pará", "uy", "ups", "no, no", "mejor",
   "eh… espera", "este… no", "como te decía mal",
   "lo voy a repetir", "lo digo de nuevo", "retomo", "rehago"

【D】 MULETILLAS — política de tolerancia cero al inicio:
• Si el snippet ARRANCA con muletilla suelta ("eh", "este", "o sea",
  "tipo", "bueno entonces"), corregí el firstWordIdx para que arranque
  DESPUÉS de la muletilla.
• Lo mismo si TERMINA con muletilla suspendida ("...y bueno", "...así
  que", "...este") — corregí el lastWordIdx para que termine antes.
• Una muletilla en el medio del flujo está bien (suena natural).
  TRES seguidas no. Si las hay, el snippet probablemente debe cortarse
  en dos.

【E】 FRAGMENTOS INCOMPLETOS:
• Snippets que empiezan a media oración ("...porque eso es lo que")
  son malos. Buscá un punto de arranque limpio.
• Snippets que terminan sin cerrar la idea ("ahora vamos a") también
  son malos. Extendé hasta cerrar o cambiá la elección.

【F】 GRANULARIDAD:
• Duración mínima de un snippet: 1.0 segundo. Más corto suena
  entrecortado.
• Duración máxima recomendada de un snippet: 12 segundos. Más largo
  típicamente es porque no estás cortando suficiente.

【G】 ORDEN NARRATIVO:
• CON GUIÓN: respetá el orden del guión EXACTAMENTE. Cada línea del
  guión = uno o más snippets contiguos. Anotá guionLineIndex en cada
  snippet (el índice 0-based de la línea del guión que cubre).
• SIN GUIÓN: empezá con el mejor HOOK (impacto, pregunta o dato),
  desarrollá, cerrá con CTA o conclusión. El orden de los clips
  crudos NO determina el orden final.

═══════════════════════════════════════════════════════════════
DURACIÓN OBJETIVO
═══════════════════════════════════════════════════════════════
• Reels / Shorts típico: 20-60 segundos finales.
• Si el material crudo es 5+ minutos, el final NO debe pasar el
  15-25% de eso. Si te tienta dejar más, recordá: mejor 25s perfectos
  que 60s con relleno.

═══════════════════════════════════════════════════════════════
BRIEF DEL CLIENTE
═══════════════════════════════════════════════════════════════
${brief}
${guionBlock}
═══════════════════════════════════════════════════════════════
TRANSCRIPCIONES POR CLIP (índices de palabra + timestamps + gaps)
═══════════════════════════════════════════════════════════════

${clipsBlock}

═══════════════════════════════════════════════════════════════
ADEMÁS DEL PLAN, DEVOLVÉ
═══════════════════════════════════════════════════════════════
• "enfasisPalabras": 5-15 palabras (lowercase, sin puntuación) que se
  resaltan visualmente en los subtítulos. Elegí CIFRAS, CTAs, palabras
  clave del brief, conceptos diferenciadores.
• "animacionOverride": si la animación default ("${animacionDefault}")
  no encaja con el tono del brief, sugerí otra (pop-scale, slide-up,
  typewriter, highlight, karaoke). Si está bien, null.
• "ideas": tu lista del PASO 2 (3-8 strings). Ayuda al sistema a
  validar que no haya redundancia.
• "observaciones": 2-3 frases. Qué cortaste y por qué — específico,
  con números. Ejemplo: "Descarté W0089-W0124 del clip 0 (autocorrección
  'perdón a ver') y la repetición de la idea 3 que aparecía también en
  clip 2."

═══════════════════════════════════════════════════════════════
FORMATO DE RESPUESTA — SOLO JSON, SIN MARKDOWN
═══════════════════════════════════════════════════════════════
{
  "ideas": [
    "Hook: la mayoría de los reels falla en los primeros 2 segundos",
    "Problema: enganches débiles",
    "Solución: estructura H-D-C",
    "CTA: probarlo en el próximo reel"
  ],
  "snippets": [
    { "clipIndex": 0, "firstWordIdx": 3,  "lastWordIdx": 18, "guionLineIndex": 0, "razon": "hook, mejor toma — descarté W0-W2 que eran 'eh bueno entonces'" },
    { "clipIndex": 0, "firstWordIdx": 45, "lastWordIdx": 72, "guionLineIndex": 1, "razon": "problema (saltée W19-W44 que era una autocorrección)" },
    { "clipIndex": 2, "firstWordIdx": 8,  "lastWordIdx": 35, "guionLineIndex": 2, "razon": "solución desarrollada en clip 2 (clip 1 también la decía pero titubeaba)" },
    { "clipIndex": 2, "firstWordIdx": 40, "lastWordIdx": 51, "guionLineIndex": 3, "razon": "CTA limpio" }
  ],
  "enfasisPalabras": ["primeros", "dos", "segundos", "estructura", "probalo", "hoy"],
  "animacionOverride": null,
  "observaciones": "Descarté las 2 versiones de la idea solución que estaban en clip 1 (W30-W55) porque clip 2 la decía más fluida. Corté la muletilla inicial en clip 0 (W0-W2: 'eh bueno entonces')."
}`;
}

/**
 * Padding al inicio y fin de cada snippet en segundos.
 * START_PAD: cuanto retroceder el inicio del snippet desde el "start" de
 *   la primera palabra. Evita cortar el ataque consonante inicial.
 * END_PAD: cuanto avanzar el fin del snippet desde el "end" de la ultima
 *   palabra. Evita cortar la consonante final (p, t, k, s). Subido a
 *   0.18 porque 0.12 dejaba la consonante final cortada de manera audible
 *   en muchos casos — el usuario reportaba "cortes a mitad de palabra".
 */
const START_PAD_SEC = 0.08;
const END_PAD_SEC = 0.18;
/** Gap maximo entre dos snippets contiguos del mismo clip para fusionarlos. */
const MERGE_GAP_SEC = 0.25;
/**
 * Silencio interno maximo dentro de un snippet. Si la transcripcion del
 * clip muestra un gap > este valor entre dos palabras consecutivas que
 * caen dentro del snippet, el snippet se PARTE en ese punto. Resuelve el
 * problema de "silencios largos que no se removieron" cuando Claude
 * devolvio un snippet que incluye una pausa interna grande.
 */
const MAX_INTERNAL_SILENCE_SEC = 0.8;

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

/**
 * Si un snippet contiene un silencio interno > MAX_INTERNAL_SILENCE_SEC
 * entre dos palabras consecutivas de su clip, lo parte en dos snippets:
 * uno que termina ANTES del silencio y otro que arranca DESPUES.
 *
 * Esto resuelve el caso "snippet de Claude abarca de 10s a 25s pero hay
 * un silencio de 1.5s en 17-18.5" — antes el silencio quedaba dentro del
 * video final; ahora se omite porque se parte el snippet.
 *
 * Se llama DESPUES de mergeContiguousSnippets para evitar que el merge
 * vuelva a unir lo que acabamos de partir (snippets adyacentes a un
 * silencio largo nunca van a tener gap < MERGE_GAP_SEC por definicion).
 */
function splitSnippetsAtLongSilences(
  snippets: SnippetPlan[],
  clips: MulticlipInputClip[],
): SnippetPlan[] {
  const byIndex = new Map(clips.map((c) => [c.index, c]));
  const out: SnippetPlan[] = [];
  for (const s of snippets) {
    const clip = byIndex.get(s.clipIndex);
    if (!clip || clip.transcripcion.length === 0) {
      out.push(s);
      continue;
    }
    // Palabras DENTRO de [s.start, s.end] del clip, en orden.
    const words = clip.transcripcion.filter(
      (w) => w.start >= s.start && w.end <= s.end,
    );
    if (words.length <= 1) {
      out.push(s);
      continue;
    }
    // Recorremos pares consecutivos buscando silencios largos.
    const breakpoints: number[] = []; // indices donde partir DESPUES
    for (let i = 0; i < words.length - 1; i++) {
      const gap = words[i + 1].start - words[i].end;
      if (gap > MAX_INTERNAL_SILENCE_SEC) {
        breakpoints.push(i);
      }
    }
    if (breakpoints.length === 0) {
      out.push(s);
      continue;
    }
    // Generar sub-snippets entre cada par de breakpoints.
    // grupo 0 = words[0..bp[0]], grupo 1 = words[bp[0]+1..bp[1]], etc.
    let prevEnd = -1;
    for (const bp of breakpoints) {
      const groupWords = words.slice(prevEnd + 1, bp + 1);
      if (groupWords.length === 0) continue;
      out.push({
        ...s,
        start: Math.max(s.start, groupWords[0].start - START_PAD_SEC),
        end: Math.min(s.end, groupWords[groupWords.length - 1].end + END_PAD_SEC),
        razon: s.razon
          ? `${s.razon} (auto-partido por silencio interno)`
          : "auto-partido por silencio interno",
      });
      prevEnd = bp;
    }
    // Ultimo grupo: desde el ultimo breakpoint hasta el final.
    const lastGroup = words.slice(prevEnd + 1);
    if (lastGroup.length > 0) {
      out.push({
        ...s,
        start: Math.max(s.start, lastGroup[0].start - START_PAD_SEC),
        end: Math.min(s.end, lastGroup[lastGroup.length - 1].end + END_PAD_SEC),
        razon: s.razon
          ? `${s.razon} (auto-partido por silencio interno)`
          : "auto-partido por silencio interno",
      });
    }
  }
  return out;
}

/**
 * Lista de palabras-señal que casi siempre indican autocorrección o error.
 * Si un snippet ARRANCA o TERMINA con una de estas, se intenta recortar
 * para excluirlas. Lowercase, sin puntuacion.
 */
const MULETILLAS_BORDE = new Set([
  // Muletillas de relleno (rioplatense + neutral)
  "eh",
  "este",
  "esto",
  "bueno",
  "entonces",
  "tipo",
  "ehh",
  "ehhh",
  "mmm",
  "mm",
  "ah",
  // Aperturas de correccion / titubeo
  "perdon",
  "perdón",
  "perdoname",
  "perdoná",
  "espera",
  "esperá",
  "ay",
  "asi",
  "así",
  "dejame",
  "déjame",
  "uy",
  "ups",
  "pará",
  "para",
]);

/**
 * Limpia muletillas en los bordes del snippet (primer/ultima palabra).
 * Devuelve los indices ajustados o null si despues del trim no queda nada.
 */
function trimBordeMuletillas(
  firstIdx: number,
  lastIdx: number,
  words: WordTimestamp[],
): { firstIdx: number; lastIdx: number } | null {
  let f = firstIdx;
  let l = lastIdx;
  const isMuletilla = (i: number) => {
    if (i < 0 || i >= words.length) return false;
    const clean = words[i].texto
      .toLowerCase()
      .replace(/[.,!?¿¡:;"'()¡¿]/g, "")
      .trim();
    return MULETILLAS_BORDE.has(clean);
  };
  // Avanzar firstIdx mientras la palabra sea muletilla suelta.
  // Limite: no avanzar mas de 3 posiciones (evita comerse el inicio real).
  let trimmedStart = 0;
  while (f <= l && trimmedStart < 3 && isMuletilla(f)) {
    f++;
    trimmedStart++;
  }
  // Retroceder lastIdx mientras sea muletilla.
  let trimmedEnd = 0;
  while (l >= f && trimmedEnd < 3 && isMuletilla(l)) {
    l--;
    trimmedEnd++;
  }
  if (l < f) return null;
  return { firstIdx: f, lastIdx: l };
}

/**
 * Resuelve un snippet a partir de índices de palabra (formato nuevo).
 * Devuelve start/end de la transcripcion REAL, sin invenciones de Claude.
 */
function resolveSnippetFromWordIdx(
  clip: MulticlipInputClip,
  firstIdx: number,
  lastIdx: number,
): { start: number; end: number } | null {
  if (firstIdx < 0 || lastIdx < 0) return null;
  if (firstIdx >= clip.transcripcion.length) return null;
  if (lastIdx >= clip.transcripcion.length) {
    // Clamp si Claude pidio una palabra fuera de rango.
    lastIdx = clip.transcripcion.length - 1;
  }
  if (lastIdx < firstIdx) return null;
  const trimmed = trimBordeMuletillas(firstIdx, lastIdx, clip.transcripcion);
  if (!trimmed) return null;
  const first = clip.transcripcion[trimmed.firstIdx];
  const last = clip.transcripcion[trimmed.lastIdx];
  return {
    start: Math.max(0, first.start - START_PAD_SEC),
    end: last.end + END_PAD_SEC,
  };
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
    if (!Number.isInteger(clipIndex)) continue;
    const clip = byIndex.get(clipIndex);
    if (!clip) continue;

    // FORMATO PREFERIDO: indices de palabra.
    // FORMATO LEGACY: start/end en segundos (backward compat).
    let resolved: { start: number; end: number } | null = null;
    const firstWordIdx =
      o.firstWordIdx !== undefined ? Number(o.firstWordIdx) : NaN;
    const lastWordIdx =
      o.lastWordIdx !== undefined ? Number(o.lastWordIdx) : NaN;
    if (Number.isInteger(firstWordIdx) && Number.isInteger(lastWordIdx)) {
      resolved = resolveSnippetFromWordIdx(clip, firstWordIdx, lastWordIdx);
    } else {
      const start = Number(o.start);
      const end = Number(o.end);
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start
      ) {
        // Snap a boundaries de palabras reales.
        resolved = snapToWords(start, end, clip.transcripcion);
      }
    }
    if (!resolved) continue;

    // Clamp a duracion del clip.
    const clampedStart = Math.max(0, Math.min(resolved.start, clip.duracion));
    const clampedEnd = Math.max(0, Math.min(resolved.end, clip.duracion));
    if (clampedEnd <= clampedStart) continue;
    // Duracion minima 1.0s — mas corto suena entrecortado. Subido de 0.3s
    // a 1.0s porque fragmentos < 1s casi siempre son muletillas sueltas
    // o snippets mal armados, no contenido util.
    if (clampedEnd - clampedStart < 1.0) continue;

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
  // Pass 1: fusionar snippets contiguos del mismo clip con gap pequeno
  // para evitar cortes "secos" entre dos pedazos vecinos.
  const merged = mergeContiguousSnippets(valid);
  // Pass 2: partir cualquier snippet que tenga un silencio interno largo.
  // Tiene que ir DESPUES del merge porque mergeContiguousSnippets puede
  // crear un snippet grande con silencio interno (si dos snippets de
  // Claude estaban muy cerca pero con un silencio largo entre las palabras
  // que cubren conjuntamente).
  return splitSnippetsAtLongSilences(merged, clips);
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
