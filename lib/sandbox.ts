import { Sandbox } from "@vercel/sandbox";

export async function createPreprocessSandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    timeout: 1_800_000,
    runtime: "node22",
    resources: { vcpus: 4 },
  });

  // node22 has no apt-get and no root. Install ffmpeg-static via npm, then
  // write the wrapper with printf + single-quoted format string so that
  // the literal "$@" is written to the file without bash expanding it.
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        "cd /tmp && npm install ffmpeg-static 2>&1 | tail -2",
        "FFMPEG_BIN=$(node -e \"process.stdout.write(require('/tmp/node_modules/ffmpeg-static'))\")",
        "mkdir -p /tmp/bin",
        "printf '#!/bin/sh\\nexec \"%s\" \"$@\"\\n' \"$FFMPEG_BIN\" > /tmp/bin/ffmpeg",
        "chmod +x /tmp/bin/ffmpeg",
        "PATH=/tmp/bin:$PATH ffmpeg -version 2>&1 | head -1",
      ].join(" && "),
    ],
  });

  const exitCode = result.exitCode;
  if (exitCode !== 0) {
    const rawErr = await result.stderr();
    const errStr = typeof rawErr === "string" ? rawErr : Buffer.from(rawErr as Uint8Array).toString("utf8");
    throw new Error(`ffmpeg setup failed (exit ${exitCode}): ${errStr.slice(-300)}`);
  }

  return sandbox;
}

export async function runInSandbox(
  sandbox: Sandbox,
  cmd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Prepend /tmp/bin so the ffmpeg wrapper installed at setup is always found
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `export PATH=/tmp/bin:$PATH; ${cmd}`],
  });

  const rawOut = await result.stdout();
  const rawErr = await result.stderr();
  return {
    stdout: typeof rawOut === "string" ? rawOut : Buffer.from(rawOut as Uint8Array).toString("utf8"),
    stderr: typeof rawErr === "string" ? rawErr : Buffer.from(rawErr as Uint8Array).toString("utf8"),
    exitCode: result.exitCode,
  };
}
