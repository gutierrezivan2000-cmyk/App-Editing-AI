import Anthropic from "@anthropic-ai/sdk";
import {
  ClienteProfile,
  WordTimestamp,
  SilenceSegment,
  InstruccionesEdicion,
} from "@/types";

// timeout slightly below Vercel's maxDuration (300 s) so we get a clean error
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 270_000 });
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

const MAX_WORDS_IN_PROMPT = 600;

export function buildOrchestrationPrompt(
  cliente: ClienteProfile,
  transcripcion: WordTimestamp[],
  silencios: SilenceSegment[],
  brief: string,
  videoInputPath: string,
  videoOutputPath: string
): string {
  // Compact serialization to reduce tokens; truncate long transcriptions
  const words = transcripcion.slice(0, MAX_WORDS_IN_PROMPT);
  const truncated = transcripcion.length > MAX_WORDS_IN_PROMPT
    ? ` (primeras ${MAX_WORDS_IN_PROMPT} de ${transcripcion.length})`
    : "";

  return `Eres un editor de video autónomo. Analiza brief, transcripción y silencios y devuelve un plan de edición ESTRUCTURADO. NO escribas código React ni TSX. Solo configuración.

PERFIL DEL CLIENTE: ${JSON.stringify(cliente)}

BRIEF: ${brief}

TRANSCRIPCIÓN${truncated}: ${JSON.stringify(words)}

SILENCIOS: ${JSON.stringify(silencios)}

RUTAS FFMPEG — Input: ${videoInputPath} | Output: ${videoOutputPath}

TAREAS:
1. Palabras de énfasis: cifras, CTAs, palabras clave del brief. Lowercase, sin puntuación, deduplicado.
2. Silencios finales: revisa y ajusta la lista. Si no hay cortes útiles devuelve [].
3. Comandos FFmpeg con filter_complex trim+concat. Codec libx264 fast crf20 aac 128k. Si no se necesitan cortes devuelve [].
4. Observaciones opcionales.

RESPONDE ÚNICAMENTE JSON:
{"enfasisPalabras":[],"silenciosFinales":[],"ffmpegCommands":[],"observaciones":"","animacionOverride":null}`;
}

export async function callClaude(prompt: string): Promise<InstruccionesEdicion> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Respuesta inesperada de Claude");

  const jsonText = block.text
    .replace(/```json\s*/g, "")
    .replace(/```\s*$/g, "")
    .trim();

  const match = jsonText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude no devolvió JSON válido");

  const parsed = JSON.parse(match[0]) as InstruccionesEdicion;

  if (!Array.isArray(parsed.enfasisPalabras)) {
    throw new Error("enfasisPalabras debe ser array");
  }
  if (!Array.isArray(parsed.ffmpegCommands)) {
    throw new Error("ffmpegCommands debe ser array");
  }

  return parsed;
}
