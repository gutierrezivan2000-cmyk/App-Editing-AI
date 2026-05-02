import { Sandbox } from "@vercel/sandbox";

export async function createPreprocessSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    timeout: 1_800_000,
    runtime: "node22",
    resources: { vcpus: 4 },
  });

  await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "apt-get update && apt-get install -y --no-install-recommends ffmpeg",
    ],
    sudo: true,
  });

  return sandbox;
}

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
