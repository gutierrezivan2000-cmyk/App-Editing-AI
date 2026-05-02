"use client";

import { Player } from "@remotion/player";
import { VideoBase } from "@/remotion/compositions/VideoBase";
import type { RenderInputProps } from "@/types";

interface Props {
  inputProps: RenderInputProps;
}

export const RemotionPlayerInner = ({ inputProps }: Props) => {
  const last = inputProps.transcripcion[inputProps.transcripcion.length - 1];
  const durationInFrames = Math.max(1, Math.ceil((last?.end ?? 30) * 30));

  return (
    <Player
      component={VideoBase as unknown as React.ComponentType<Record<string, unknown>>}
      inputProps={inputProps as unknown as Record<string, unknown>}
      durationInFrames={durationInFrames}
      fps={30}
      compositionWidth={1080}
      compositionHeight={1920}
      style={{ width: "100%", maxHeight: 480 }}
      controls
    />
  );
};
