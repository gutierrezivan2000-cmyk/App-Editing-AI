"use client";

import { forwardRef, useMemo } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { VideoBase } from "@/remotion/compositions/VideoBase";
import { MulticlipComposition } from "@/remotion/compositions/MulticlipComposition";
import type {
  ClienteProfile,
  ClipMultiSource,
  SnippetPlan,
  WordTimestamp,
} from "@/types";

interface RemotionPreviewProps {
  /**
   * URL del video unido (fallback cuando NO se pasan clips+snippets).
   * Si se pasan clips+snippets, este campo se ignora y el video se
   * reconstruye en vivo del lado del cliente.
   */
  videoUrl: string;
  transcripcion: WordTimestamp[];
  enfasisPalabras: string[];
  clienteProfile: ClienteProfile;
  /**
   * Cuando se pasan, se usa MulticlipComposition que reconstruye el
   * video desde los clips originales con los snippets actuales (preview
   * en tiempo real de cortes/orden). Si no, se usa VideoBase con el
   * videoUrl pre-renderizado.
   */
  clips?: ClipMultiSource[];
  snippets?: SnippetPlan[];
}

/**
 * Preview en vivo del video con subtitulos.
 *
 * DOS MODOS:
 *
 *  1. Modo "edicion en vivo" (cuando recibe clips + snippets): la
 *     composicion `MulticlipComposition` reconstruye el video desde los
 *     clips originales. Cualquier cambio en snippets (orden, recorte) se
 *     refleja al instante en el preview.
 *
 *  2. Modo "video pre-renderizado" (solo videoUrl): la composicion
 *     `VideoBase` muestra el video_unido.mp4 ya armado. Mas eficiente
 *     pero no refleja cambios en snippets.
 *
 * El editor usa el modo 1; otros lugares que solo necesitan mostrar el
 * output final pueden usar el modo 2. El framing (borde, sombra) es
 * responsabilidad del padre — este componente solo renderiza el Player.
 */
export const RemotionPreview = forwardRef<PlayerRef, RemotionPreviewProps>(
  function RemotionPreview(
    {
      videoUrl,
      transcripcion,
      enfasisPalabras,
      clienteProfile,
      clips,
      snippets,
    },
    ref,
  ) {
    const useLiveMode =
      Array.isArray(clips) && Array.isArray(snippets) && snippets.length > 0;

    const formato = clienteProfile.exportacion.formatos[0] ?? "9:16";
    const dims = useMemo(() => {
      const map: Record<typeof formato, { width: number; height: number }> = {
        "9:16": { width: 1080, height: 1920 },
        "1:1": { width: 1080, height: 1080 },
        "16:9": { width: 1920, height: 1080 },
      };
      return map[formato] ?? map["9:16"];
    }, [formato]);

    const fps = clienteProfile.exportacion.fps ?? 30;

    // Duracion total:
    //   - En modo live: suma de duraciones de snippets (lo que va a sonar)
    //   - En modo video pre-rendered: hasta el final de la transcripcion
    const totalDurationSec = useMemo(() => {
      if (useLiveMode && snippets) {
        const sum = snippets.reduce((acc, s) => acc + (s.end - s.start), 0);
        return Math.max(1, sum);
      }
      const last = transcripcion[transcripcion.length - 1];
      return Math.max(1, last?.end ?? 10);
    }, [useLiveMode, snippets, transcripcion]);

    const durationInFrames = Math.max(1, Math.ceil(totalDurationSec * fps));

    // inputProps separados por modo — cada Player tipa estrictamente
    // sus props y no podemos compartirlos.
    const liveProps = useMemo(
      () =>
        useLiveMode && clips && snippets
          ? {
              clips,
              snippets,
              transcripcion,
              enfasisPalabras,
              clienteProfile,
            }
          : null,
      [
        useLiveMode,
        clips,
        snippets,
        transcripcion,
        enfasisPalabras,
        clienteProfile,
      ],
    );
    const staticProps = useMemo(
      () => ({
        videoUrl,
        transcripcion,
        clienteProfile,
        enfasisPalabras,
      }),
      [videoUrl, transcripcion, clienteProfile, enfasisPalabras],
    );

    return (
      <div
        className="bg-black"
        style={{
          aspectRatio: `${dims.width} / ${dims.height}`,
          width: "100%",
          maxHeight: "calc(100vh - 16rem)",
        }}
      >
        {liveProps ? (
          <Player
            ref={ref}
            component={MulticlipComposition}
            inputProps={liveProps}
            durationInFrames={durationInFrames}
            fps={fps}
            compositionWidth={dims.width}
            compositionHeight={dims.height}
            controls
            loop={false}
            style={{ width: "100%", height: "100%" }}
            acknowledgeRemotionLicense
          />
        ) : (
          <Player
            ref={ref}
            component={VideoBase}
            inputProps={staticProps}
            durationInFrames={durationInFrames}
            fps={fps}
            compositionWidth={dims.width}
            compositionHeight={dims.height}
            controls
            loop={false}
            style={{ width: "100%", height: "100%" }}
            acknowledgeRemotionLicense
          />
        )}
      </div>
    );
  },
);
