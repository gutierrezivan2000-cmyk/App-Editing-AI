import { Sandbox } from "@vercel/sandbox";

export async function runInSandbox(
  sandbox: Sandbox,
  cmd: string,
  opts: { sudo?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", cmd],
    ...(opts.sudo ? { sudo: true } : {}),
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

  // Install ffmpeg with sudo; detect package manager (apt-get on Debian, apk on Alpine)
  const install = await runInSandbox(
    sandbox,
    `if command -v apt-get >/dev/null 2>&1; then
       apt-get update -qq && apt-get install -y --no-install-recommends ffmpeg
     elif command -v apk >/dev/null 2>&1; then
       apk add --no-cache ffmpeg
     else
       echo "No supported package manager (tried apt-get, apk)" && exit 1
     fi`,
    { sudo: true }
  );
  if (install.exitCode !== 0) {
    throw new Error(
      `ffmpeg install failed (exit ${install.exitCode}): ${(install.stdout + install.stderr).slice(-600)}`
    );
  }

  return sandbox;
}
