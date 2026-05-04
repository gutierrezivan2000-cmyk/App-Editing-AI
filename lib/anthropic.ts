import Anthropic from "@anthropic-ai/sdk";
import {
  ClienteProfile,
  WordTimestamp,
  SilenceSegment,
  InstruccionesEdicion,
} from "@/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

export function buildOrchestrationPrompt(
  cliente: ClienteProfile,
  transcripcion: WordTimestamp[],
  silencios: SilenceSegment[],
  brief: string,
  videoInputPath: string,
  videoOutputPath: string
): string {
  const textoPlano = transcripcion.map((w) => w.texto).join(" ");

  const textoTruncado =
    textoPlano.length > 4000
      ? textoPlano.slice(0, 4000) + "… [truncado]"
      : textoPlano;

  const timestampsMuestra = transcripcion
    .slice(0, 150)
    .map((w) => ({ w: w.texto, s: w.start, e: w.end }));

  const silenciosMuestra = silencios.slice(0, 200);

  const prompt = `Eres un editor de video autónomo. Analiza brief, transcripción y silencios y
devuelve un plan de edición ESTRUCTURADO. NO escribas código React ni TSX. Solo
configuración.

PERFIL DEL CLIENTE (resumen):
- Fuente: ${cliente.subtitulos.fuente_principal}
- Animación: ${cliente.subtitulos.animacion}
- Color énfasis: ${cliente.subtitulos.color_enfasis}
- Redes: ${cliente.redes.join(", ")}

BRIEF:
${brief}

TRANSCRIPCIÓN COMPLETA (texto plano, ${transcripcion.length} palabras):
${textoTruncado}

MUESTRA DE TIMESTAMPS (primeras 150 palabras, formato {w,s,e}):
${JSON.stringify(timestampsMuestra)}

SILENCIOS DETECTADOS (${silencios.length} total, mostrando ${silenciosMuestra.length}):
${JSON.stringify(silenciosMuestra)}

RUTAS PARA FFMPEG:
- Input: ${videoInputPath}
- Output final del corte: ${videoOutputPath}

TAREAS:
1. Identifica palabras de énfasis (cifras, datos, CTAs, palabras clave del brief).
   Devuelve en lowercase, sin puntuación, deduplicado.
2. Revisa silencios. Devuelve la lista FINAL de segmentos a cortar.
3. Compón los comandos FFmpeg en orden para cortar el footage.
   Si no hay silencios que cortar, devuelve ffmpegCommands como array vacío [].
   Si hay cortes:
   - Usa filter_complex con trim+concat para los segmentos a conservar.
   - Output final SIEMPRE debe ser ${videoOutputPath}.
   - No uses rutas absolutas que no sean las dadas.
   - Codec: libx264, preset: fast, crf: 20, audio aac 128k.
4. Notas opcionales para revisión humana.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO con esta estructura exacta:
{
  "enfasisPalabras": ["palabra1", "palabra2"],
  "silenciosFinales": [{"start": 0.0, "end": 0.5, "duracion": 0.5}],
  "ffmpegCommands": [],
  "observaciones": "string",
  "animacionOverride": null
}`;

  if (prompt.length > 50_000) {
    return prompt.slice(0, 50_000) + "\n\n[PROMPT TRUNCADO POR LÍMITE DE TAMAÑO]";
  }
  return prompt;
}

export async function callClaude(prompt: string): Promise<InstruccionesEdicion> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Respuesta inesperada de Claude");

  // Strip all markdown code fences regardless of language tag
  const jsonText = block.text
    .replace(/```[\w]*\s*/g, "")
    .replace(/```/g, "")
    .trim();

  const match = jsonText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude no devolvió JSON válido");

  let parsed: InstruccionesEdicion;
  try {
    parsed = JSON.parse(match[0]) as InstruccionesEdicion;
  } catch {
    throw new Error(`JSON inválido de Claude: ${match[0].slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.enfasisPalabras)) {
    throw new Error("enfasisPalabras debe ser array");
  }
  if (!Array.isArray(parsed.ffmpegCommands)) {
    throw new Error("ffmpegCommands debe ser array");
  }

  return parsed;
}
