import path from "node:path";
import fs from "node:fs";
import { ClienteProfile } from "@/types";
import { getClienteFromDB } from "./db";

export async function getClienteProfile(id: string): Promise<ClienteProfile> {
  const jsonPath = path.join(process.cwd(), "data", "clientes", `${id}.json`);
  if (fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    return JSON.parse(raw) as ClienteProfile;
  }

  const fromDB = await getClienteFromDB(id);
  if (!fromDB) throw new Error(`ClienteProfile no encontrado: ${id}`);
  return fromDB;
}
