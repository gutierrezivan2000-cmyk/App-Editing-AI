import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SubtitulosDinamicos } from "./SubtitulosDinamicos";
import type {
  ClienteProfile,
  ClipMultiSource,
  SnippetPlan,
  WordTimestamp,
} from "@/types";

interface MulticlipCompositionProps {
  clips: ClipMultiSource[];
  snippets: SnippetPlan[];
  transcripcion: WordTimestamp[];
  clienteProfile: ClienteProfile;
  enfasisPalabras: string[];
}

/**
 * Composicion Remotion que RECONSTRUYE el video del lado del cliente
 * usando los clips originales + los snippets actuales. NO usa el
 * `video_unido.mp4` pre-renderizado del pipeline.
 *
 * Por qué: si en el editor el usuario reordena snippets o ajusta in/out,
 * el video debe reflejarlo INMEDIATAMENTE — no esperar a que el usuario
 * guarde + regenere + re-ejecute ffmpeg (que tarda 5+ min). Esta
 * composicion hace exactamente lo que ffmpeg hace pero en el browser
 * con `<Sequence>` y `<OffthreadVideo>`:
 *
 *   ┌─────── Sequence(from=0, dur=120) ───────┐
 *   │  OffthreadVideo(clip0, startFrom=10s)   │
 *   └──────────────────────────────────────────┘
 *   ┌── Sequence(from=120, dur=90) ──┐
 *   │  OffthreadVideo(clip2, …)      │
 *   └────────────────────────────────┘
 *   ...
 *
 * Remotion solo descarga el rango necesario de cada clip (HTTP Range
 * requests), asi que con clips grandes solo paga el ancho de banda de
 * los segmentos que efectivamente se reproducen.
 *
 * Es el mismo componente que usa el editor; el render del pipeline
 * server-side sigue usando VideoBase con el video_unido pre-renderizado
 * (mas eficiente para el render final, no necesita reconstruir).
 */
export const MulticlipComposition = ({
  clips,
  snippets,
  transcripcion,
  clienteProfile,
  enfasisPalabras,
}: MulticlipCompositionProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Marcar palabras de énfasis por igualdad case-insensitive contra el
  // texto limpio (sin puntuacion).
  const enfasisSet = new Set(enfasisPalabras.map((p) => p.toLowerCase()));
  const transcripcionConEnfasis = transcripcion.map((w) => ({
    ...w,
    enfasis: enfasisSet.has(
      w.texto.toLowerCase().replace(/[.,!?¿¡:;"'()]/g, ""),
    ),
  }));

  // Calcular posiciones acumuladas en SEGUNDOS (float) y derivar
  // start/end en frames con Math.round del cumulativo. Esto garantiza
  // que `endFrame[i] === startFrame[i+1]` exacto — sin micro-gaps
  // entre snippets ni drift al final del timeline.
  //
  // Bug original: hacíamos `durFrames = round((end-start)*fps)` y
  // `cumulativeFrames += durFrames`. Cada snippet acumulaba 0.5 frames
  // de error, y para 16 snippets eso eran ~8 frames (medio segundo a
  // 30fps) de gap al final donde ningun Sequence renderizaba — al
  // hacer click ahí desde el timeline, el preview quedaba negro.
  let cumulativeSec = 0;
  const sequences = snippets.map((s, i) => {
    const startFrameInTimeline = Math.round(cumulativeSec * fps);
    const dur = s.end - s.start;
    cumulativeSec += dur;
    const endFrameInTimeline = Math.round(cumulativeSec * fps);
    const durFrames = Math.max(1, endFrameInTimeline - startFrameInTimeline);
    return {
      key: i,
      from: startFrameInTimeline,
      durationInFrames: durFrames,
      snippet: s,
    };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {sequences.map(({ key, from, durationInFrames, snippet }) => {
        const clip = clips[snippet.clipIndex];
        if (!clip || !clip.url) return null;
        const startFromFrames = Math.max(0, Math.round(snippet.start * fps));
        return (
          <Sequence
            key={key}
            from={from}
            durationInFrames={durationInFrames}
            layout="none"
          >
            <AbsoluteFill style={{ backgroundColor: "black" }}>
              <OffthreadVideo
                src={clip.url}
                startFrom={startFromFrames}
                // No usamos endAt — el Sequence ya limita la duracion.
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      <SubtitulosDinamicos
        transcripcion={transcripcionConEnfasis}
        config={clienteProfile.subtitulos}
        frame={frame}
        fps={fps}
      />
    </AbsoluteFill>
  );
};
