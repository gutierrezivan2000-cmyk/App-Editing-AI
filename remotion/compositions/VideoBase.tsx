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
      {videoUrl ? (
        // objectFit:"cover" llena todo el canvas manteniendo aspect ratio
        // (croppea si hace falta). Antes sin estilo, OffthreadVideo se
        // renderizaba en su tamano intrinseco HTML (300x150) y quedaba
        // como sello chico arriba a la izquierda del canvas 1080x1920.
        <OffthreadVideo
          src={videoUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : null}
      <SubtitulosDinamicos
        transcripcion={transcripcionConEnfasis}
        config={clienteProfile.subtitulos}
        frame={frame}
        fps={fps}
      />
    </AbsoluteFill>
  );
};
