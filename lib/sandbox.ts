import { Sandbox } from "@vercel/sandbox";

export async function createPreprocessSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    timeout: 1_800_000,
    runtime: "node22",
    resources: { vcpus: 4 },
  });

  // node22 runtime doesn't have apt-get; install ffmpeg via ffmpeg-static npm package
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        "cd /tmp && npm install ffmpeg-static 2>&1 | tail -2",
        "node -e \"const{execSync}=require('child_process');execSync('ln -sf '+require('/tmp/node_modules/ffmpeg-static')+' /usr/local/bin/ffmpeg')\"",
        "ffmpeg -version 2>&1 | head -1",
      ].join(" && "),
    ],
  });

  const exitCode = result.exitCode;
  if (exitCode !== 0) {
    const stderr = await result.stderr();
    throw new Error(`ffmpeg setup failed (exit ${exitCode}): ${stderr.slice(-300)}`);
  }

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
