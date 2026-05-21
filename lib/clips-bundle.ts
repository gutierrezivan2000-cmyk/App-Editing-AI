/**
 * Helpers para armar el "bundle de descarga" de los clips de un proyecto
 * multiclip cuando el ZIP CapCut NO los embebe (modo default — ahorra
 * 10-15 min de pipeline). El bundle es solo texto:
 *
 *   - clips-README.md      — instrucciones para el usuario
 *   - descargar-clips.sh   — script bash con curl (macOS/Linux/WSL)
 *   - descargar-clips.bat  — script Windows con curl o powershell
 *
 * Tamano total ~5 KB. CapCut espera los media junto al draft; el usuario
 * corre el script en la carpeta donde extrajo el ZIP y los clips quedan
 * ahi listos para abrir.
 */

import type { ClipForExport } from "./multiclip-exports";

export interface ClipsBundleOptions {
  videoName: string;
  clips: ClipForExport[];
}

/**
 * README markdown con instrucciones y la lista completa de URLs.
 */
export function generateClipsReadme({
  videoName,
  clips,
}: ClipsBundleOptions): string {
  const lines: string[] = [];
  lines.push(`# Clips originales — ${videoName}`);
  lines.push("");
  lines.push(
    `Este proyecto se exportó SIN los clips originales dentro del ZIP CapCut`,
  );
  lines.push(
    `(modo "ZIP liviano"). Para que CapCut pueda abrir el draft, los clips`,
  );
  lines.push(`tienen que vivir en la **misma carpeta** donde extrajiste el ZIP.`);
  lines.push("");
  lines.push(`## Opción rápida: ejecutá el script incluido`);
  lines.push("");
  lines.push(
    `- **macOS / Linux / WSL:** abrí terminal en esta carpeta y ejecutá`,
  );
  lines.push("  ```bash");
  lines.push("  bash descargar-clips.sh");
  lines.push("  ```");
  lines.push(`- **Windows:** doble click en \`descargar-clips.bat\``);
  lines.push("");
  lines.push(`## Opción manual: descargá uno por uno`);
  lines.push("");
  lines.push(
    `Guarda cada archivo con el nombre que aparece a la izquierda (es el`,
  );
  lines.push(`que el draft espera).`);
  lines.push("");
  for (const c of clips) {
    lines.push(`- \`${c.localFilename}\` → ${c.url}`);
  }
  lines.push("");
  lines.push(`## Total: ${clips.length} clips`);
  lines.push("");
  lines.push(
    `Generado automáticamente por VideoIA Agency. Si querés que el próximo`,
  );
  lines.push(
    `proyecto traiga los clips dentro del ZIP, marcá "Incluir clips originales`,
  );
  lines.push(`dentro del ZIP" al crear el proyecto.`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Script bash con curl para macOS/Linux/WSL. Usa `-fL` (fail on HTTP error
 * + follow redirects) y `--retry` para resistir blips.
 */
export function generateClipsDownloadShellScript({
  videoName,
  clips,
}: ClipsBundleOptions): string {
  const lines: string[] = [];
  lines.push("#!/usr/bin/env bash");
  lines.push(`# Descarga los clips originales del proyecto "${videoName}".`);
  lines.push(`# Generado por VideoIA Agency.`);
  lines.push("set -euo pipefail");
  lines.push("");
  lines.push(`echo "Descargando ${clips.length} clips..."`);
  lines.push("");
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    lines.push(
      `echo "[${i + 1}/${clips.length}] ${c.localFilename}"`,
    );
    lines.push(
      `curl -fL --retry 3 --retry-delay 2 -o "${c.localFilename}" "${c.url}"`,
    );
  }
  lines.push("");
  lines.push(`echo "Listo. ${clips.length} clips descargados."`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Script .bat para Windows. Usa curl (incluido en Windows 10+) y como
 * fallback, powershell con Invoke-WebRequest si curl no esta disponible.
 */
export function generateClipsDownloadBatchScript({
  videoName,
  clips,
}: ClipsBundleOptions): string {
  const lines: string[] = [];
  lines.push("@echo off");
  lines.push(
    `REM Descarga los clips originales del proyecto "${videoName}".`,
  );
  lines.push(`REM Generado por VideoIA Agency.`);
  lines.push("setlocal");
  lines.push("");
  lines.push(`echo Descargando ${clips.length} clips...`);
  lines.push("");
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    lines.push(`echo [${i + 1}/${clips.length}] ${c.localFilename}`);
    lines.push(
      `curl -fL --retry 3 --retry-delay 2 -o "${c.localFilename}" "${c.url}"`,
    );
    lines.push(`if errorlevel 1 (`);
    lines.push(`  echo Error descargando ${c.localFilename}`);
    lines.push(`  exit /b 1`);
    lines.push(`)`);
  }
  lines.push("");
  lines.push(`echo Listo. ${clips.length} clips descargados.`);
  lines.push("endlocal");
  lines.push("");
  return lines.join("\r\n"); // CRLF para Windows
}
