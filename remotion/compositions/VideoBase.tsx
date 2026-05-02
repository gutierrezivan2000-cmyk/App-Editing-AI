import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { SubtitulosDinamicos } from "./SubtitulosDinamicos";
import type { RenderInputProps } from "@/types";

export const VideoBase = ({
  videoUrl,
  transcripcion,
  clienteProfile,
  enfasisPalabras,
}: RenderInputProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enfasisSet = new Set(enfasisPalabras.map((p) => p.toLowerCase()));

  const transcripcionConEnfasis = transcripcion.map((w) => ({
    ...w,
    enfasis: enfasisSet.has(
      w.texto.toLowerCase().replace(/[.,!?¿¡:;"'()]/g, "")
    ),
  }));

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {videoUrl ? <OffthreadVideo src={videoUrl} /> : null}
      <SubtitulosDinamicos
        transcripcion={transcripcionConEnfasis}
        config={clienteProfile.subtitulos}
        frame={frame}
        fps={fps}
      />
    </AbsoluteFill>
  );
};
