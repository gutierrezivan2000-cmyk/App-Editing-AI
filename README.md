# VideoIA Agency

Sistema autónomo de edición de video con IA para agencias. Cargás
**clips crudos + brief en texto** y la app entrega:

- **MP4 final** con silencios removidos y subtítulos animados sincronizados
- **Project files editables** para Premiere Pro (XML), DaVinci Resolve (EDL) y CapCut (ZIP con draft)
- **SRT universal** importable en YouTube, Premiere, CapCut, etc.

Todo en ~5-12 minutos según las opciones, sin intervención humana en el camino.

> 📖 **Documento técnico-funcional detallado**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
> — 20 secciones explicando qué resuelve la app, cómo funciona cada
> capa del stack, decisiones arquitectónicas, performance real,
> trade-offs y roadmap.

---

## ¿Qué hace exactamente?

1. **Subís N clips** (hasta 20) + un brief opcional + un guión opcional
2. La app **transcribe cada clip** con Whisper palabra por palabra
3. **Claude Sonnet 4.5** decide qué cortar, qué orden tienen los snippets, qué palabras enfatizar visualmente, y qué animación usar
4. **FFmpeg** dentro de Vercel Sandbox recorta + concatena los clips según el plan de Claude
5. **Remotion** renderiza un MP4 final con subtítulos animados (opcional)
6. **Exporta** XML, EDL, CapCut ZIP y SRT para que un humano pueda ajustar si quiere

Editor visual integrado: si después de generar querés tocar algo, hay
un editor estilo CapCut con timeline, waveform, tab de estilo, undo/redo
y preview Remotion en vivo. Cuando guardás, podés "Re-render final"
para regenerar el MP4 sin volver a correr todo el pipeline.

---

## Stack

| Capa | Tecnología |
|------|------------|
| Framework | [Next.js 15](https://nextjs.org) App Router + TypeScript estricto + React 19 |
| UI | [TailwindCSS 4](https://tailwindcss.com) |
| Renderer de video | [Remotion 4](https://www.remotion.dev) (`@remotion/vercel` para ejecutar en sandbox) |
| Compute on-demand | [`@vercel/sandbox`](https://vercel.com/docs/vercel-sandbox) — FFmpeg corre acá, nunca en API routes |
| Storage binarios | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) |
| Base de datos | Vercel Postgres (Neon) |
| Cola de jobs | [Inngest](https://www.inngest.com) — pipelines async con retries automáticos |
| LLM orquestador | Claude Sonnet 4.5 (`@anthropic-ai/sdk`) |
| Transcripción | OpenAI Whisper API |
| Auth | Auth.js v5 (NextAuth) con email/password en DB |
| Rate limiting | Upstash Ratelimit (opcional) |

Para edición de video local sin sandbox hay un módulo **Montaje
automático** que usa `ffmpeg-static` directamente — útil para casos
simples de "cortar silencios y entregar MP4".

---

## Decisiones arquitectónicas (las que no se negocian)

Documentadas en [`AGENTS.md`](AGENTS.md). Resumen:

1. **Claude devuelve JSON de configuración, NUNCA código TSX en runtime.**
   Los outputs del LLM son datos que parametrizan componentes Remotion estáticos.
2. **FFmpeg corre dentro de Vercel Sandbox, NUNCA en API routes** (los
   sandboxes tienen IO ilimitada, CPU dedicada y aislamiento).
3. **Pipelines van por Inngest, NO con fire-and-forget.** Cada I/O en
   su propio `step.run()` con retries automáticos.
4. **Webhooks ClickUp validan firma HMAC siempre.**
5. **Sandboxes: siempre `shutdown()` en `finally`** o sino consumen
   créditos.
6. **Rate limiting + Spend Management activos desde el día 1.**

---

## Pipelines (Inngest functions)

7 funciones registradas en [`app/api/inngest/route.ts`](app/api/inngest/route.ts):

### `procesarMulticlipProyecto` — el path principal
Hasta 20 clips → un MP4 final coherente. Steps:

```
preflight → analyze-clips (paralelo)
         → transcribe-clips (Whisper paralelo, conc 3)
         → claude-multiclip (plan con selección por índice de palabra)
         → ffmpeg-multiclip-concat (recortar + uniformizar + concat)
         → adjust-transcripcion-multiclip
         → generate-multiclip-exports (XML / EDL / CapCut / SRT)
         → final-render Remotion (opcional, solo si renderSubtitulos=true)
```

Tiempo típico para 16 clips × ~60 MB cada uno:
- **Sin Remotion render**: ~5-7 minutos
- **Con Remotion render**: ~10-15 minutos

### `procesarCortesProyecto` — para 1 clip largo
Claude decide qué cortar (silencios, errores, repeticiones, muletillas)
y entrega los mismos project files + MP4 con subs quemados.

### `procesarVideo` — modo "original" o "mirage"
Versión simple para 1 clip. Mirage usa Captions.ai como render engine
alternativo (más rápido para Reels 9:16 ≤1min).

### `cortarSilencios` — módulo independiente
Solo cortar silencios → entregar XML/EDL/CapCut para editar en
Premiere. Sin Claude, sin Whisper. Tabla `cortes` separada.

### `procesarMontaje` — módulo Montaje automático
Versión local de `cortarSilencios` que devuelve el MP4 ya montado, sin
necesidad de re-editar en Premiere/CapCut. Usa ffmpeg-static (no
sandbox) — ideal para clips chicos.

### `rerenderizarMulticlipFinal` y `replanificarMulticlipFinal`
Para iterar sobre un proyecto ya completado: re-renderizar el video
final con cambios del editor (rerender) o re-ejecutar el step "Plan
Claude" con un prompt mejorado (replan) sin re-procesar los clips.

---

## Cómo correrlo local (Windows)

### Requisitos

- Node.js 22+
- npm
- Cuenta de Vercel con proyecto linkeado (`vercel link`)
- API keys: Anthropic, OpenAI, Vercel Blob, Vercel Postgres, Auth.js secret
- (Opcional) Upstash Redis, ClickUp webhook secret, Mirage API key

### Setup

```bash
git clone https://github.com/gutierrezivan2000-cmyk/App-Editing-AI.git
cd App-Editing-AI
npm install
cp .env.local.example .env.local
# editar .env.local con tus claves
```

### Correr en dev

Hay dos formas:

**Modo simple** (1 terminal por proceso):

```bash
# Terminal 1: Next.js dev
npm run dev

# Terminal 2: Inngest CLI dev
npx inngest-cli@latest dev
```

**Modo PM2 recomendado** (ya configurado en
[`ecosystem.config.js`](ecosystem.config.js)):

```bash
pm2 start ecosystem.config.js
```

Levanta 4 procesos: `videoia-next`, `videoia-inngest`,
`videoia-oidc-cron` (refresca el token OIDC de Vercel cada 6h) y
`videoia-stuck-cron` (mata pipelines colgados >8min sin updates).

### Aplicar migraciones de DB

Después del primer setup o después de pull, correr:

```bash
curl -X POST http://localhost:3000/api/migrate \
  -H "x-admin-secret: $AUTH_SECRET"
```

Ver [`MIGRATION.md`](MIGRATION.md) para más detalle.

---

## Editor visual

El editor está en `/dashboard/proyectos/[id]/editor` (botón "Abrir
editor" en la página del proyecto). Solo disponible para proyectos
multiclip completados.

Features:

- **Preview Remotion en vivo**: reordenás snippets o recortás → el
  preview refleja el cambio al instante (sin re-renderizar)
- **Tab Subtítulos**: editar texto + timestamps palabra por palabra
- **Tab Énfasis**: agregar/quitar palabras a resaltar visualmente
- **Tab Snippets**: drag-drop para reordenar, TrimBar con handles
  arrastrables para recortar in/out
- **Tab Estilo**: cambiar fuente, color, animación, posición de los subs
  (override por proyecto sobre el perfil del cliente)
- **Timeline NLE-style**: 3 tracks (Video, Subs, Audio waveform),
  cursor sincronizado, zoom, click-to-seek
- **Undo/Redo** unificado para todos los cambios (Ctrl+Z, Ctrl+Y)
- **"Re-sincronizar subs"**: si reordenaste snippets y los subs
  quedaron desfasados, re-deriva la transcripción ajustada
- **"Re-render final"**: encola un job que re-arma video_unido +
  exports + opcional MP4 quemado con el estado actual

---

## Estructura del proyecto

```
app/
  (auth)/login, signup                  → páginas de auth
  (dashboard)/dashboard/
    clientes/                           → CRUD de perfiles de cliente
    cortar/                             → módulo cortar-silencios-a-XML
    montaje/                            → módulo Montaje automático
    proyectos/[id]/editor/              → editor visual multiclip
  api/
    auth/, clientes/, cortar/,          → CRUD endpoints
    inngest/                            → webhook Inngest
    migrate/                            → schema migrations
    pipeline/                           → encolado + control de pipelines
      [projectId]/
        rerender-output, replan,        → endpoints del editor
        resync-transcripcion, ...
    webhooks/clickup/                   → integración con ClickUp
components/
  proyectos/editor/                     → editor visual (11 componentes)
  ...
inngest/functions/                      → 7 pipeline functions
lib/
  anthropic-multiclip.ts                → planificador con selección por índice
  multiclip-utils.ts                    → ffmpeg concat builder
  multiclip-exports.ts                  → generadores XML/EDL/CapCut
  sandbox.ts                            → wrapper @vercel/sandbox
  ...
migrations/                             → SQL aplicado por /api/migrate
remotion/
  compositions/
    VideoBase.tsx                       → render server-side (video_unido)
    MulticlipComposition.tsx            → preview live en el editor
    SubtitulosDinamicos.tsx             → componente de subs animados (5 estilos)
scripts/                                → helpers dev (PM2 + utils)
```

---

## Capturas conceptuales

> _Capturas reales irán acá cuando esté en producción._

- **Listado de proyectos** con métricas (total / completados hoy / en proceso / con error)
- **Página de creación**: subida múltiple con drag-drop, brief, guión opcional, render method selector
- **Pipeline status en vivo**: cronómetro por step, sub-paso, porcentaje
- **Editor visual dark-themed**: timeline, preview, paneles

---

## Roadmap pendiente

- [ ] Compartir sandbox entre `analyze-clips` y `ffmpeg-concat` (descargar
      clips UNA sola vez) → bajar pipeline a 3-5 min
- [ ] Detectar formato uniforme en clips → skip re-encode en concat
- [ ] UI del módulo Montaje automático con preview
- [ ] Endpoint público (sin login) con webhook de respuesta para flows ClickUp/Zapier
- [ ] Mejorar prompt de Claude con few-shot examples reales

---

## Convenciones del proyecto

Ver [`AGENTS.md`](AGENTS.md). Resumen rápido:

- TypeScript estricto, sin `any` implícito
- Imports absolutos con alias `@/`
- `async/await`, nunca `.then()/.catch()`
- Nombres de funciones de negocio en español (`procesarMulticlipProyecto`),
  utilidades técnicas en inglés (`withNetworkRetry`)
- Cada I/O del pipeline en su propio `step.run()` de Inngest
- Comentarios explican el "por qué", no el "qué" — muchos documentan
  cicatrices de incidentes pasados (network blips, OOM, expired tokens, etc.)

---

## Licencia

Proyecto privado / personal. Si querés usarlo, escribime y vemos.

---

🤖 Construido con la asistencia de [Claude Code](https://claude.com/claude-code) y Claude Sonnet 4.5.
