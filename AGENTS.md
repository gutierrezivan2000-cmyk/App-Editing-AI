# AGENTS.md — Sistema Autónomo de Edición de Video con IA para Agencias

> Este archivo es leído por Claude Code antes de comenzar cualquier tarea.
> Contiene la arquitectura, convenciones, comandos y contexto del proyecto.
> No requiere instrucciones adicionales — comienza a construir desde aquí.


---

## Descripción del Proyecto

Sistema full-stack que permite a una agencia de video cargar footage crudo y un brief
en texto, y recibir automáticamente videos editados con silencios removidos, subtítulos
dinámicos animados y exportación multi-formato para redes sociales.

**Claude API** actúa como orquestador de edición y devuelve **configuración JSON**, no
código. **Remotion** (vía `@remotion/vercel`) renderiza los subtítulos sobre Vercel
Sandbox. **FFmpeg** procesa audio/video dentro del mismo Sandbox. **Whisper** transcribe
con timestamps por palabra. **Inngest** orquesta el pipeline asíncrono con retries.

---

## Decisiones Arquitectónicas Críticas (No Negociables)

1. **Claude genera JSON de configuración, NUNCA código TSX en runtime.**
2. **FFmpeg corre dentro de Vercel Sandbox, NUNCA en API routes.**
3. **El pipeline corre en Inngest, NO con fire-and-forget.**
4. **Webhooks ClickUp validan firma HMAC siempre.**
5. **Rate limiting + Vercel Spend Management activos desde el día 1.**
6. **Sandboxes: SIEMPRE `shutdown()` en `finally`.**

---

## Stack Tecnológico

| Capa              | Tecnología                              | Versión       |
|-------------------|-----------------------------------------|---------------|
| Framework         | Next.js App Router (TypeScript estricto)| ^15.0.0       |
| UI                | TailwindCSS                             | ^4.0.0        |
| Render de video   | Remotion + `@remotion/vercel`           | ^4.0.x        |
| Compute on-demand | `@vercel/sandbox`                       | latest        |
| Storage binarios  | Vercel Blob                             | ^0.22.0       |
| Base de datos     | Vercel Postgres (Neon)                  | ^0.8.0        |
| Cola de jobs      | Inngest                                 | ^3.x          |
| Rate limiting     | `@upstash/ratelimit` + `@upstash/redis` | latest        |
| LLM orquestador   | Anthropic SDK (`claude-sonnet-4-5`)     | ^0.30.0       |
| Transcripción     | OpenAI SDK (Whisper API, `whisper-1`)   | ^4.50.0       |
| Auth              | Auth.js (NextAuth v5)                   | ^5.0.0-beta   |

---

## Comandos del Proyecto

```bash
npm install
npm run dev
npm run build          # bundle Remotion + next build
npm run lint
npx tsc --noEmit
npx remotion bundle remotion/index.ts ./remotion-bundle
npx inngest-cli@latest dev
vercel --prod
```

---

## Convenciones de Código

- **TypeScript estricto** (`strict: true`). Sin `any` implícito.
- API routes con `try/catch` y errores estructurados `{ error: string }`.
- **Imports absolutos** con alias `@/`.
- **Async/await**, nunca `.then()/.catch()`.
- **Nombres en español** para funciones de negocio, **inglés** para utilidades técnicas.
- **Vercel Blob** para todo binario.
- **Inngest steps**: cada I/O en su propio `step.run()`.
- **Sandboxes**: siempre `shutdown()` en `finally`.

