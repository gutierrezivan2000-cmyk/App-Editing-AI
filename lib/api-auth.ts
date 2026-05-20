import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Helper de autorización para route handlers de Next.js (App Router).
 *
 * Antes de esta capa, NINGUNA route en app/api/* validaba sesión. El
 * middleware solo cubría `/dashboard(.*)` así que cualquier visitante anónimo
 * podía hacer POST /api/pipeline, listar clientes, descargar outputs, etc.
 *
 * Uso típico al inicio de cada handler:
 *
 *   const session = await requireAuth();
 *   if (session instanceof NextResponse) return session; // 401
 *   const userId = session.user.id;
 *
 * Devuelve `NextResponse` (status 401) si no hay sesión, o un objeto
 * tipo-sesión con `user.id` no-null si sí.
 *
 * Excepciones (rutas que NO usan este helper porque tienen su propia
 * autenticación):
 *   - /api/auth/*           — endpoints de NextAuth
 *   - /api/inngest          — webhook de Inngest (firma propia)
 *   - /api/webhooks/clickup — webhook ClickUp (HMAC propia)
 *   - /api/migrate          — header x-admin-secret
 */
export type AuthedSession = {
  user: { id: string; email?: string | null; name?: string | null };
};

export async function requireAuth(): Promise<AuthedSession | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    },
  };
}
