import type { WordTimestamp } from "@/types";

/**
 * Genera un archivo SRT a partir de una transcripcion palabra-a-palabra.
 *
 * SRT es el formato universal de subtitulos:
 *   - Premiere Pro lo importa nativamente: File → Import → seleccionar .srt
 *     y se agrega como caption track al timeline
 *   - DaVinci Resolve: File → Import → Subtitle, o arrastrar al timeline
 *   - CapCut: Captions → Import → SRT
 *   - YouTube / VLC / cualquier player: leen SRT sin conversion
 *
 * Formato SRT:
 *   1
 *   00:00:01,200 --> 00:00:03,500
 *   Hola, este es el primer subtítulo
 *
 *   2
 *   00:00:03,500 --> 00:00:05,800
 *   Y este es el segundo
 *
 *   ...
 *
 * Agrupamos palabras en "lineas" segun `palabrasPorLinea` del cliente,
 * igual que en el render Remotion y el CapCut draft — asi los 3 outputs
 * tienen el mismo timing de subtitulos.
 */
export function generarSRT(
  transcripcion: WordTimestamp[],
  palabrasPorLinea = 4,
): string {
  if (transcripcion.length === 0) return "";

  // Agrupar palabras en lineas. Igual logica que CapCut/Remotion.
  const lineas: WordTimestamp[][] = [];
  for (let i = 0; i < transcripcion.length; i += palabrasPorLinea) {
    lineas.push(transcripcion.slice(i, i + palabrasPorLinea));
  }

  const entries: string[] = [];
  lineas.forEach((linea, idx) => {
    if (linea.length === 0) return;
    const texto = linea.map((w) => w.texto).join(" ").trim();
    if (!texto) return;
    const start = linea[0].start;
    // El fin es el end de la ultima palabra. Si la linea siguiente empieza
    // antes que eso (overlap por jitter del whisper), clamp al inicio de la
    // siguiente menos 0.05s para no superponer.
    let end = linea[linea.length - 1].end;
    const next = lineas[idx + 1];
    if (next && next[0] && next[0].start < end) {
      end = Math.max(start + 0.1, next[0].start - 0.05);
    }
    entries.push(
      `${idx + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${texto}\n`,
    );
  });

  return entries.join("\n");
}

/**
 * Formatea un timestamp en segundos al formato SRT: HH:MM:SS,mmm
 *
 * Ej: 65.432 -> "00:01:05,432"
 *
 * SRT usa coma como separador decimal (no punto). VTT usa punto, pero
 * la mayoria de tools tambien aceptan VTT si renombras .srt → .vtt.
 */
function toSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}
