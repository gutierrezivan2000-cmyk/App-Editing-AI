import {
  createSandbox,
  addBundleToSandbox,
  renderMediaOnVercel,
  uploadToVercelBlob,
} from "@remotion/vercel";
import type { RenderInputProps } from "@/types";

// Pass a bare relative path — addBundleToSandbox does path.join(cwd, bundleDir)
// internally. If we pass an absolute path, path.join concatenates the two absolute
// segments: path.join('/var/task', '/var/task/build') → '/var/task/var/task/build'.
// With a relative "build", path.join('/var/task', 'build') → '/var/task/build' ✓
const BUNDLE_DIR = "build";

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
