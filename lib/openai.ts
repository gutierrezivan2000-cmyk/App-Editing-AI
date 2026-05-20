import OpenAI from "openai";
import { WordTimestamp } from "@/types";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribirConWhisperDesdeUrl(
  blobUrl: string
): Promise<WordTimestamp[]> {
  const res = await fetch(blobUrl);
  if (!res.ok) throw new Error(`No se pudo descargar ${blobUrl}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  // Date.now() colisiona bajo concurrency (varias transcripciones en
  // paralelo en la misma function instance). UUID elimina el riesgo.
  // Usamos .mp3 porque eso es lo que extrae el pipeline; Whisper detecta
  // el formato por contenido pero la extensión correcta evita warnings.
  const tmpPath = path.join(tmpdir(), `whisper-${randomUUID()}.mp3`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
      language: "es",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    return (transcription.words ?? []).map((w) => ({
      texto: w.word.trim(),
      start: w.start,
      end: w.end,
      enfasis: false,
    }));
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // El cleanup no debe enmascarar errores reales de Whisper.
    }
  }
}
