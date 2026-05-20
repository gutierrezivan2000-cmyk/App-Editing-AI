import {
  createSandbox,
  addBundleToSandbox,
  renderMediaOnVercel,
} from "@remotion/vercel";
import { uploadSandboxFileToBlob } from "./sandbox";
import type { RenderInputProps } from "@/types";

// Pass a bare relative path — addBundleToSandbox does path.join(cwd, bundleDir)
// internally. If we pass an absolute path, path.join concatenates the two absolute
// segments: path.join('/var/task', '/var/task/build') → '/var/task/var/task/build'.
// With a relative "build", path.join('/var/task', 'build') → '/var/task/build' ✓
const BUNDLE_DIR = "build";

// El default de @remotion/vercel es 5 minutos (SANDBOX_CREATING_TIMEOUT en
// la lib). Para un render multiclip con 6+ clips + subtitulos animados el
// render puede tardar 8-15 min: el sandbox MUERE a mitad y todas las
// llamadas siguientes devuelven HTTP 410 "sandbox_stopped".
// 30 minutos cubre el peor caso razonable (20 clips, 3min de output).
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;

export async function renderizarVideoFinal(
  projectId: string,
  inputProps: RenderInputProps
): Promise<{ url: string }> {
  const sandbox = await createSandbox({
    timeoutInMilliseconds: SANDBOX_TIMEOUT_MS,
  });
  try {
    await addBundleToSandbox({ sandbox, bundleDir: BUNDLE_DIR });

    await renderMediaOnVercel({
      sandbox,
      compositionId: "VideoBase",
      inputProps: inputProps as unknown as Record<string, unknown>,
      codec: "h264",
      outputFile: "/tmp/output.mp4",
      // Por si el render llegara a tardar mas que la creacion del sandbox.
      timeoutInMilliseconds: SANDBOX_TIMEOUT_MS,
    });

    // Antes usabamos `uploadToVercelBlob` de @remotion/vercel pero NO acepta
    // allowOverwrite. En el segundo reintento de un proyecto el blob
    // outputs/<id>.mp4 ya existe y rechaza el upload. Pasamos al helper
    // propio que SI fuerza allowOverwrite (compartido con lib/blob.ts).
    const url = await uploadSandboxFileToBlob(
      sandbox,
      "/tmp/output.mp4",
      `outputs/${projectId}.mp4`,
      "video/mp4",
    );
    return { url };
  } finally {
    await sandbox.stop();
  }
}
