import OpenAI from "openai";
import { WordTimestamp } from "@/types";
import fs from "node:fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribirConWhisperDesdeUrl(
  blobUrl: string
): Promise<WordTimestamp[]> {
  const res = await fetch(blobUrl);
  if (!res.ok) throw new Error(`No se pudo descargar ${blobUrl}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = `/tmp/whisper-${Date.now()}.mp4`;
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
    fs.unlinkSync(tmpPath);
  }
}
