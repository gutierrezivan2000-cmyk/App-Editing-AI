#!/usr/bin/env node

/**
 * Script para ejecutar migraciones contra la API /api/migrate.
 *
 * Uso:
 *   npx ts-node scripts/migrate.ts --url https://tu-app.vercel.app --secret tu-secret
 *
 * O con variables de entorno:
 *   MIGRATION_URL=https://tu-app.vercel.app AUTH_SECRET=tu-secret npx ts-node scripts/migrate.ts
 */

import * as fs from "fs";
import * as path from "path";

const url = process.env.MIGRATION_URL || process.argv[2]?.split("=")[1];
const secret = process.env.AUTH_SECRET || process.argv[3]?.split("=")[1];

async function runMigration() {
  if (!url) {
    console.error("❌ Error: URL de la app no proporcionada.");
    console.log("\nUso:");
    console.log(
      "  npx ts-node scripts/migrate.ts https://tu-app.vercel.app tu-secret\n"
    );
    console.log("O con variables de entorno:");
    console.log(
      "  MIGRATION_URL=https://tu-app.vercel.app AUTH_SECRET=tu-secret npx ts-node scripts/migrate.ts\n"
    );
    process.exit(1);
  }

  if (!secret) {
    console.error("❌ Error: AUTH_SECRET no proporcionado.");
    console.log("Asegúrate de tener AUTH_SECRET en tu variable de entorno.");
    process.exit(1);
  }

  try {
    console.log("🚀 Iniciando migración...");
    console.log(`   URL: ${url}`);
    console.log(`   Secret: ${secret.substring(0, 8)}...`);

    const migrateUrl = new URL("/api/migrate", url);
    const response = await fetch(migrateUrl.toString(), {
      method: "POST",
      headers: {
        "x-admin-secret": secret,
      },
    });

    const data = (await response.json()) as {
      ok?: boolean;
      applied?: string[];
      error?: string;
    };

    if (!response.ok) {
      console.error(`\n❌ Error (${response.status}):`, data.error);
      process.exit(1);
    }

    if (data.ok) {
      console.log("\n✅ Migración completada exitosamente!");
      console.log("\nMigraciones aplicadas:");
      (data.applied ?? []).forEach((m) => console.log(`   • ${m}`));
      console.log(
        "\n✓ La tabla 'cortes' está lista para usar en /dashboard/cortar"
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Error al conectar: ${msg}`);
    console.error("\nVerifica que:");
    console.error("  • La URL es correcta");
    console.error("  • AUTH_SECRET es correcto");
    console.error("  • La base de datos está disponible en Vercel");
    process.exit(1);
  }
}

runMigration();
