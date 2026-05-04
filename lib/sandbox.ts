import { Sandbox } from "@vercel/sandbox";

export async function runInSandbox(
  sandbox: Sandbox,
  cmd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", cmd],
  });
  return {
    stdout: await result.stdout(),
    stderr: await result.stderr(),
    exitCode: result.exitCode,
  };
}

export async function createPreprocessSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    timeout: 1_800_000,
    runtime: "node22",
    resources: { vcpus: 4 },
  });

  const { exitCode, stderr } = await runInSandbox(
    sandbox,
    "apt-get update -qq 2>&1 && apt-get install -y --no-install-recommends ffmpeg 2>&1"
  );
  if (exitCode !== 0) {
    throw new Error(`ffmpeg install failed (exit ${exitCode}): ${stderr.slice(-500)}`);
  }

  return sandbox;
}
