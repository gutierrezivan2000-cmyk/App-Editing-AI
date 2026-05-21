import { Sandbox } from "@vercel/sandbox";

/**
 * Codigos de error que sabemos que son transitorios y vale la pena
 * reintentar. La gran mayoria son errores de red entre nuestro Node y
 * la API de Vercel Sandbox (que rompe con SocketError "other side
 * closed" cuando el otro lado cierra idle connections o hay un blip).
 */
const TRANSIENT_NETWORK_PATTERNS = [
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  // El mensaje literal "terminated" lo tira undici cuando la conexion
  // se cae a la mitad — equivalente a UND_ERR_SOCKET pero a veces
  // viene en .message y no en .code.
  "terminated",
  "other side closed",
  "fetch failed",
];

export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // Junta message + code + cause.code + cause.message para chequear todos
  // los lugares donde Node mete info del fallo de red.
  const e = err as {
    message?: string;
    code?: string;
    cause?: { message?: string; code?: string };
  };
  const haystack = [
    e.message ?? "",
    e.code ?? "",
    e.cause?.message ?? "",
    e.cause?.code ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return TRANSIENT_NETWORK_PATTERNS.some((p) =>
    haystack.includes(p.toLowerCase()),
  );
}

/**
 * Reintenta una funcion async si falla con un error de red transitorio.
 *
 * Tres intentos con backoff exponencial: 1s, 3s, 7s. La mayoria de los
 * network blips contra api.vercel.com se resuelven en <3s, asi que con
 * 3 intentos cubrimos ~95% de los casos sin agregar latencia perceptible
 * en el happy path.
 *
 * Si el error NO es transitorio (ej. exitCode no-cero, sintaxis bash mal,
 * archivo no existe), propaga inmediatamente — no tiene sentido reintentar
 * esos.
 */
async function withNetworkRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isNetworkError(err) || attempt === maxAttempts) {
        throw err;
      }
      const backoffMs = [1000, 3000, 7000][attempt - 1] ?? 7000;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[sandbox] ${label} fallo intento ${attempt}/${maxAttempts}: ${msg.slice(0, 100)}. Reintentando en ${backoffMs}ms…`,
      );
      await new Promise((res) => setTimeout(res, backoffMs));
    }
  }
  throw lastError;
}

/**
 * Script Node que corre DENTRO del sandbox para subir un archivo al Vercel
 * Blob. Usa STREAMING (`createReadStream` + `multipart: true`) para que la
 * memoria usada sea constante (~64 KB de buffer interno) sin importar
 * cuan grande sea el archivo.
 *
 * Antes usabamos `readFileSync` que cargaba todo el archivo en RAM de
 * Node. Para videos unidos >500 MB esto reventaba el heap (max-old-space
 * ~1.5 GB default), el OS mataba el proceso con SIGKILL y el pipeline
 * fallaba con "exit 137" sin contexto. Streaming arregla el problema de
 * raiz — soporta archivos de cualquier tamano que quepa en disco.
 *
 * `multipart: true` le dice a `@vercel/blob.put()` que use el upload
 * multipart de S3 (chunks de 5 MB en paralelo). Mas robusto a network
 * blips que el upload de una sola pieza.
 *
 * Se invoca como:
 *   node upload-blob.mjs '{"sandboxFilePath":"/tmp/x.mp4", ...}'
 *
 * El script imprime al stdout una linea JSON {type:"done", url, size} si
 * salio OK, o exit 1 con stderr si fallo.
 */
const UPLOAD_BLOB_SCRIPT = `
import { createReadStream, statSync } from "fs";
import { put } from "@vercel/blob";
const config = JSON.parse(process.argv[2]);
try {
  const size = statSync(config.sandboxFilePath).size;
  const stream = createReadStream(config.sandboxFilePath);
  const blob = await put(config.blobPath, stream, {
    access: config.access || "public",
    contentType: config.contentType,
    token: config.blobToken,
    allowOverwrite: true,
    multipart: true,
  });
  console.log(JSON.stringify({ type: "done", url: blob.url, downloadUrl: blob.downloadUrl, size }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
`;

export async function createPreprocessSandbox(): Promise<Sandbox> {
  // El propio Sandbox.create puede fallar con `terminated` si la API
  // de Vercel cierra el socket — reintentamos 3 veces antes de propagar.
  const sandbox = await withNetworkRetry("Sandbox.create", () =>
    Sandbox.create({
      timeout: 1_800_000,
      runtime: "node22",
      resources: { vcpus: 4 },
    }),
  );

  // node22 has no apt-get and no root. Install ffmpeg-static + @vercel/blob
  // via npm. ffmpeg-static es el binario que el wrapper /tmp/bin/ffmpeg
  // llama; @vercel/blob es para upload-blob.mjs que sube archivos grandes
  // sin pasar por stdout (que rompe con strings > ~512MB).
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        "cd /tmp && npm install ffmpeg-static @vercel/blob 2>&1 | tail -2",
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
    const errStr = bufferToString(rawErr);
    throw new Error(`ffmpeg setup failed (exit ${exitCode}): ${errStr.slice(-300)}`);
  }

  // Escribir el script de upload en el CWD del sandbox. El script importa
  // @vercel/blob, asi que necesita estar donde node pueda resolver el
  // modulo — lo escribimos en /tmp donde acabamos de instalar.
  await sandbox.writeFiles([
    {
      path: "/tmp/upload-blob.mjs",
      content: Buffer.from(UPLOAD_BLOB_SCRIPT, "utf8"),
    },
  ]);

  return sandbox;
}

// Cuando un proceso (típicamente ffmpeg con error en loop) produce GBs de
// stdout/stderr, `Buffer.toString("utf8")` lanza `RangeError: Invalid string
// length`. Truncamos el buffer al final antes de decodificar — el final es
// lo útil para diagnosticar fallos.
const MAX_OUTPUT_BYTES = 200_000; // 200 KB es más que suficiente para logs útiles

function bufferToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
  if (buf.length > MAX_OUTPUT_BYTES) {
    return (
      `[... output recortado: ${buf.length} bytes en total, mostrando últimos ${MAX_OUTPUT_BYTES} ...]\n` +
      buf.slice(buf.length - MAX_OUTPUT_BYTES).toString("utf8")
    );
  }
  return buf.toString("utf8");
}

export async function runInSandbox(
  sandbox: Sandbox,
  cmd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Prepend /tmp/bin so the ffmpeg wrapper installed at setup is always
  // found. withNetworkRetry cubre el caso de UND_ERR_SOCKET / terminated
  // entre nuestro Node y la API Vercel — el comando solo se reintentaria
  // si la network falla, NO si ffmpeg dentro del sandbox falla.
  const result = await withNetworkRetry(`runCommand: ${cmd.slice(0, 40)}…`, () =>
    sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", `export PATH=/tmp/bin:$PATH; ${cmd}`],
    }),
  );

  const rawOut = await withNetworkRetry("runCommand.stdout()", () =>
    result.stdout(),
  );
  const rawErr = await withNetworkRetry("runCommand.stderr()", () =>
    result.stderr(),
  );
  return {
    stdout: bufferToString(rawOut),
    stderr: bufferToString(rawErr),
    exitCode: result.exitCode,
  };
}

/**
 * Variante de runInSandbox que devuelve `stdout` como Buffer crudo, sin
 * pasar por `bufferToString` (que trunca a 200 KB para evitar OOM con logs
 * gigantes de ffmpeg en error).
 *
 * Usar cuando el comando produce binarios o salidas grandes — p.ej.
 * `base64 -w 0 archivo.mp4`: un mp4 de 10 MB genera ~14 MB de base64, y la
 * versión "string" lo truncaría silenciosamente subiendo blobs corruptos.
 *
 * stderr sigue truncándose porque es solo para diagnóstico, no datos útiles.
 */
export async function runInSandboxRaw(
  sandbox: Sandbox,
  cmd: string
): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
  const result = await withNetworkRetry(
    `runCommand raw: ${cmd.slice(0, 40)}…`,
    () =>
      sandbox.runCommand({
        cmd: "bash",
        args: ["-lc", `export PATH=/tmp/bin:$PATH; ${cmd}`],
      }),
  );

  const rawOut = await withNetworkRetry("runCommand raw.stdout()", () =>
    result.stdout(),
  );
  const rawErr = await withNetworkRetry("runCommand raw.stderr()", () =>
    result.stderr(),
  );
  const stdout = Buffer.isBuffer(rawOut)
    ? rawOut
    : typeof rawOut === "string"
      ? Buffer.from(rawOut, "utf8")
      : Buffer.from(rawOut as Uint8Array);
  return {
    stdout,
    stderr: bufferToString(rawErr),
    exitCode: result.exitCode,
  };
}

/**
 * Escapa un string para que sea seguro como literal entre comillas simples
 * en bash. Reemplaza cada `'` por `'\''` (terminar string, escapar, abrir
 * string), y envuelve todo entre comillas simples.
 *
 * Resultado: cualquier shell metacharacter dentro del input se vuelve
 * literal — imposible inyectar comandos. Usar SIEMPRE para interpolar
 * inputs externos (URLs, nombres de archivo, etc.) en comandos bash.
 */
export function shSingleQuote(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

/**
 * Descarga una URL al sandbox con `curl -fsSL`, blindado contra shell
 * injection. Antes hacíamos `curl -fsSL "${url}"` directo — una URL maliciosa
 * con comillas + `;` ejecutaba comandos arbitrarios en el sandbox.
 *
 * Defensas:
 *  - Valida que la URL sea http(s):// (parseo con `new URL`)
 *  - Bloquea hostnames "internos" (localhost, 127.0.0.1, IPs privadas, *.local)
 *    para mitigar SSRF — un usuario malicioso no debería poder hacer al
 *    sandbox fetchar metadata del cloud provider (169.254.169.254, etc.)
 *  - Escapa la URL y el destino con single-quote
 */
export async function downloadInSandbox(
  sandbox: Sandbox,
  url: string,
  destPath: string
): Promise<{ stderr: string; exitCode: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL inválida: ${url.slice(0, 100)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Protocolo no permitido: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  const blockedHosts = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254", // AWS/GCP/Azure metadata
    "metadata.google.internal",
  ];
  if (
    blockedHosts.includes(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    throw new Error(`Host no permitido: ${host}`);
  }
  const cmd = `curl -fsSL --max-time 600 -o ${shSingleQuote(destPath)} ${shSingleQuote(url)}`;
  const result = await runInSandbox(sandbox, cmd);
  return { stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * Descarga N archivos en paralelo dentro del sandbox. Usa `xargs -P` para
 * limitar la concurrencia (default 4 — balance entre velocidad y memoria
 * del sandbox: cada curl mantiene buffers internos, y 16 simultaneos
 * pueden saturar el ancho de banda compartido).
 *
 * Antes haciamos un loop secuencial desde Node llamando downloadInSandbox
 * por cada clip — round-trips innecesarios y red serializada. Esta version
 * escribe un manifest TSV (url\tdest) al sandbox y lo procesa con xargs.
 *
 * Si CUALQUIER curl falla, xargs propaga exit code distinto de 0.
 * Cada URL se valida primero contra SSRF/protocol igual que downloadInSandbox.
 */
export async function downloadInSandboxBatch(
  sandbox: Sandbox,
  items: { url: string; destPath: string }[],
  concurrency: number = 4,
): Promise<{ stderr: string; exitCode: number }> {
  if (items.length === 0) return { stderr: "", exitCode: 0 };

  // Validar cada URL antes de meterla al sandbox.
  for (const it of items) {
    let parsed: URL;
    try {
      parsed = new URL(it.url);
    } catch {
      throw new Error(`URL inválida: ${it.url.slice(0, 100)}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Protocolo no permitido: ${parsed.protocol}`);
    }
    const host = parsed.hostname.toLowerCase();
    const blockedHosts = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "169.254.169.254",
      "metadata.google.internal",
    ];
    if (
      blockedHosts.includes(host) ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      throw new Error(`Host no permitido: ${host}`);
    }
  }

  // Escribimos un manifest TSV al sandbox. TAB como separador porque URLs
  // y paths no pueden contener TAB legitimamente (los espacios en URLs
  // estarian %20-encoded). El downloader bash splittea por el primer TAB.
  const manifest = items.map((it) => `${it.url}\t${it.destPath}`).join("\n") + "\n";
  const manifestPath = `/tmp/dl-manifest-${Date.now()}.tsv`;
  const scriptPath = `/tmp/dl-batch.sh`;

  const downloaderScript =
    `#!/bin/bash\n` +
    `set -euo pipefail\n` +
    // dl <pair>: pair = "url<TAB>dest"
    `dl() {\n` +
    `  local pair="$1"\n` +
    `  local url="\${pair%%$(printf '\\t')*}"\n` +
    `  local dest="\${pair#*$(printf '\\t')}"\n` +
    `  curl -fsSL --max-time 600 -o "$dest" "$url"\n` +
    `}\n` +
    `export -f dl\n` +
    // xargs lee el manifest, una linea por invocacion, P paralelos.
    `xargs -a "$1" -d '\\n' -L 1 -P "$2" bash -c 'dl "$0"'\n`;

  await sandbox.writeFiles([
    {
      path: manifestPath,
      content: Buffer.from(manifest, "utf8"),
    },
    {
      path: scriptPath,
      content: Buffer.from(downloaderScript, "utf8"),
    },
  ]);

  const cmd = `bash ${scriptPath} ${shSingleQuote(manifestPath)} ${concurrency}`;
  const result = await runInSandbox(sandbox, cmd);
  return { stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * Sube un archivo desde dentro de un sandbox al Vercel Blob, sin pasar por
 * stdout (que rompe con archivos grandes — ver historia en lib/blob.ts).
 *
 * Funciona con CUALQUIER sandbox, no solo `createPreprocessSandbox`:
 *   1. Si `/tmp/upload-blob.mjs` no existe, lo escribe.
 *   2. Si `@vercel/blob` no esta instalado en /tmp/node_modules, lo
 *      instala. Esto cubre sandboxes creados por @remotion/vercel que
 *      no traen @vercel/blob preinstalado.
 *   3. Ejecuta el script con node, parsea la respuesta JSON y devuelve
 *      la URL publica del blob.
 *
 * IMPORTANTE: `allowOverwrite: true` esta hardcodeado dentro del script
 * para soportar reintentos de proyectos (el blob `outputs/<id>.mp4` ya
 * existe en el segundo run). Sin esa flag, Vercel Blob rechaza con
 * "This blob already exists".
 */
export async function uploadSandboxFileToBlob(
  sandbox: Sandbox,
  sandboxFilePath: string,
  blobPath: string,
  contentType: string
): Promise<string> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN no esta configurado");
  }

  // 1. Asegurar que @vercel/blob esta disponible. Si el directorio del
  //    modulo existe, cortocircuita (rapido); si no, instala.
  //
  //    Antes usabamos un if/then/fi en un array.join(' ') que producia
  //    `if ... then ... fi` todo en una linea sin separadores, y bash
  //    fallaba con "syntax error: unexpected end of file". Single-line
  //    con `||` evita el problema: bash lo parsea como una sola expresion.
  const setup = await runInSandbox(
    sandbox,
    "test -d /tmp/node_modules/@vercel/blob || (cd /tmp && npm install @vercel/blob 2>&1 | tail -3)",
  );
  if (setup.exitCode !== 0) {
    throw new Error(
      `Setup de @vercel/blob fallo en sandbox: ${setup.stderr.slice(-200)}`,
    );
  }

  // 2. Escribir el script si no existe. writeFiles es idempotente.
  await withNetworkRetry("writeFiles upload-blob.mjs", () =>
    sandbox.writeFiles([
      {
        path: "/tmp/upload-blob.mjs",
        content: Buffer.from(UPLOAD_BLOB_SCRIPT, "utf8"),
      },
    ]),
  );

  // 3. Ejecutar el script.
  const config = {
    sandboxFilePath,
    blobPath,
    contentType,
    blobToken,
    access: "public" as const,
  };
  const cmd = await withNetworkRetry("node upload-blob.mjs", () =>
    sandbox.runCommand({
      cmd: "node",
      args: ["/tmp/upload-blob.mjs", JSON.stringify(config)],
      cwd: "/tmp",
    }),
  );

  if (cmd.exitCode !== 0) {
    const stderr = await withNetworkRetry("upload cmd.stderr()", () =>
      cmd.stderr(),
    );
    const errStr = Buffer.isBuffer(stderr)
      ? stderr.toString("utf8")
      : String(stderr);
    throw new Error(
      `Upload del archivo ${sandboxFilePath} fallo (exit ${cmd.exitCode}): ${errStr.slice(-300)}`,
    );
  }

  const stdout = await withNetworkRetry("upload cmd.stdout()", () =>
    cmd.stdout(),
  );
  const stdoutStr = Buffer.isBuffer(stdout)
    ? stdout.toString("utf8")
    : String(stdout);
  const lines = stdoutStr.trim().split("\n").filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1] ?? "";
  let parsed: { url?: string; downloadUrl?: string; size?: number };
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    throw new Error(
      `Respuesta inesperada del script de upload (no es JSON): ${stdoutStr.slice(-200)}`,
    );
  }
  if (!parsed.url) {
    throw new Error(`Script de upload no devolvio url. Respuesta: ${lastLine}`);
  }
  return parsed.url;
}
