"use client";

import dynamic from "next/dynamic";
import type { RenderInputProps } from "@/types";

interface VideoPreviewProps {
  outputUrl: string;
  inputProps?: RenderInputProps;
}

export const VideoPreview = ({ outputUrl, inputProps }: VideoPreviewProps) => {
  if (inputProps) {
    return (
      <div className="overflow-hidden rounded-xl bg-black">
        <RemotionPlayerPreview inputProps={inputProps} />
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

const RemotionPlayerPreview = dynamic(
  () => import("./RemotionPlayerInner").then((m) => m.RemotionPlayerInner),
  { ssr: false }
);
