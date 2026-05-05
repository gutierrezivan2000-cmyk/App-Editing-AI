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

  // node22 runtime is minimal (no apt-get/apk). Install ffmpeg via the
  // ffmpeg-static npm package (works on any Linux x64 since npm is available).
  const install = await runInSandbox(
    sandbox,
    `set -e
     mkdir -p /tmp/ff && cd /tmp/ff
     [ -f package.json ] || npm init -y >/dev/null 2>&1
     npm install ffmpeg-static --silent --no-audit --no-fund --no-progress 2>&1
     FFPATH=$(node -e "process.stdout.write(require('/tmp/ff/node_modules/ffmpeg-static'))")
     test -f "$FFPATH" || { echo "ffmpeg-static binary not found"; exit 1; }
     cp "$FFPATH" /usr/local/bin/ffmpeg
     chmod +x /usr/local/bin/ffmpeg
     ffmpeg -version | head -n 1`,
    { sudo: true }
  );
  if (install.exitCode !== 0) {
    throw new Error(
      `ffmpeg install failed (exit ${install.exitCode}): ${(install.stdout + install.stderr).slice(-600)}`
    );
  }

  return sandbox;
}
