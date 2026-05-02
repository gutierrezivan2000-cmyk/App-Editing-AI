"use client";

import dynamic from "next/dynamic";
import type { RenderInputProps } from "@/types";

const Player = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  { ssr: false }
);

interface VideoPreviewProps {
  outputUrl: string;
  inputProps?: RenderInputProps;
}

export const VideoPreview = ({ outputUrl, inputProps }: VideoPreviewProps) => {
  if (inputProps) {
    return (
      <div className="overflow-hidden rounded-xl bg-black">
        <Player
          component={
            dynamic(
              () =>
                import("@/remotion/compositions/VideoBase").then(
                  (m) => m.VideoBase
                ),
              { ssr: false }
            ) as Parameters<typeof Player>[0]["component"]
          }
          inputProps={inputProps}
          durationInFrames={Math.ceil(
            (inputProps.transcripcion[inputProps.transcripcion.length - 1]?.end ??
              30) * 30
          )}
          fps={30}
          compositionWidth={1080}
          compositionHeight={1920}
          style={{ width: "100%", maxHeight: 480 }}
          controls
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-black">
      <video
        src={outputUrl}
        controls
        className="w-full max-h-[480px] object-contain"
      />
    </div>
  );
};
