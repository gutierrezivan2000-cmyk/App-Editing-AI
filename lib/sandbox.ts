import { Sandbox } from "@vercel/sandbox";

export async function createPreprocessSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    timeout: 1_800_000,
    runtime: "node22",
    resources: { vcpus: 4 },
  });

  // node22 has no apt-get and no root; install ffmpeg-static via npm and
  // place a wrapper script in /tmp/bin (user-writable) instead of /usr/local/bin
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        "cd /tmp && npm install ffmpeg-static 2>&1 | tail -2",
        "mkdir -p /tmp/bin",
        "node -e \"const fs=require('fs'),p=require('/tmp/node_modules/ffmpeg-static');fs.writeFileSync('/tmp/bin/ffmpeg','#!/bin/sh\\nexec \\\"'+p+'\\\" \\\"$@\\\"\\n');fs.chmodSync('/tmp/bin/ffmpeg',0o755)\"",
        "PATH=/tmp/bin:$PATH ffmpeg -version 2>&1 | head -1",
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
  // Always prepend /tmp/bin so the ffmpeg wrapper installed at setup is found
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `export PATH=/tmp/bin:$PATH; ${cmd}`],
  });
  return {
    stdout: await result.stdout(),
    stderr: await result.stderr(),
    exitCode: result.exitCode,
  };
}
