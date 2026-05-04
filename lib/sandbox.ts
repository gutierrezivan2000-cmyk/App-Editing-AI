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

  // Detect package manager: Debian/Ubuntu → apt-get, Alpine → apk
  const install = await runInSandbox(
    sandbox,
    `if command -v apt-get >/dev/null 2>&1; then
       apt-get update -qq 2>&1 && apt-get install -y --no-install-recommends ffmpeg 2>&1
     elif command -v apk >/dev/null 2>&1; then
       apk add --no-cache ffmpeg 2>&1
     else
       echo "No supported package manager found" >&2 && exit 1
     fi`
  );
  if (install.exitCode !== 0) {
    throw new Error(`ffmpeg install failed (exit ${install.exitCode}): ${install.stdout.slice(-500)}`);
  }

  return sandbox;
}
