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

    // Duracion en frames del Player.
    //
    // En modo LIVE: tenemos que coincidir EXACTO con la composicion
    // MulticlipComposition (que ahora deriva cada start/end frame con
    // Math.round del cumulativo en segundos). Si no coincidimos, el
    // ultimo frame del Player cae despues del ultimo Sequence y el
    // preview queda negro al hacer seek al final del timeline.
    //
    // En modo pre-rendered: hasta el final de la transcripcion.
    const durationInFrames = useMemo(() => {
      if (useLiveMode && snippets && snippets.length > 0) {
        // Replicamos EXACTAMENTE el calculo del MulticlipComposition:
        // sum de end frames acumulados con Math.round del segundo
        // cumulativo. Esto da el ultimo endFrame, que es la duracion
        // que vamos a alimentar al Player.
        let cumulativeSec = 0;
        for (const s of snippets) cumulativeSec += s.end - s.start;
        return Math.max(1, Math.round(cumulativeSec * fps));
      }
      const last = transcripcion[transcripcion.length - 1];
      return Math.max(1, Math.ceil((last?.end ?? 10) * fps));
    }, [useLiveMode, snippets, transcripcion, fps]);

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
