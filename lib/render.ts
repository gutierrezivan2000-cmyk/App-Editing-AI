import {
  createSandbox,
  addBundleToSandbox,
  renderMediaOnVercel,
  uploadToVercelBlob,
} from "@remotion/vercel";
import type { RenderInputProps } from "@/types";

// Relative path — addBundleToSandbox resolves it against process.cwd() internally.
// Passing an absolute path causes a doubled prefix (/var/task/var/task/...) on Vercel.
const BUNDLE_DIR = "./remotion-bundle";

export async function renderizarVideoFinal(
  projectId: string,
  inputProps: RenderInputProps
): Promise<{ url: string; size: number }> {
  const sandbox = await createSandbox();
  try {
    await addBundleToSandbox({ sandbox, bundleDir: BUNDLE_DIR });

    await renderMediaOnVercel({
      sandbox,
      compositionId: "VideoBase",
      inputProps: inputProps as unknown as Record<string, unknown>,
      codec: "h264",
      outputFile: "/tmp/output.mp4",
    });

    return await uploadToVercelBlob({
      sandbox,
      sandboxFilePath: "/tmp/output.mp4",
      blobPath: `outputs/${projectId}.mp4`,
      contentType: "video/mp4",
      blobToken: process.env.BLOB_READ_WRITE_TOKEN!,
      access: "public",
    });
  } finally {
    await sandbox.stop();
  }
}
