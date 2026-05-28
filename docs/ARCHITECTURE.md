# Arquitectura de VideoIA Agency

Documento técnico-funcional detallado. Acá está todo lo que necesitás saber
para entender qué resuelve VideoIA Agency, cómo lo resuelve y por qué cada
decisión arquitectónica está donde está.

Si querés una vista rápida ver el [README](../README.md). Si querés las
reglas no-negociables del proyecto, [AGENTS.md](../AGENTS.md). Este doc
está pensado para developers que llegan al repo o stakeholders que
quieren entender el producto con profundidad.

---

## Tabla de contenidos

1. [El problema que resuelve](#1-el-problema-que-resuelve)
2. [Cómo funciona — visión funcional](#2-cómo-funciona--visión-funcional)
3. [Arquitectura técnica — vista 30,000 pies](#3-arquitectura-técnica--vista-30000-pies)
4. [Stack en detalle](#4-stack-en-detalle)
5. [Los pipelines (Inngest functions)](#5-los-pipelines-inngest-functions)
6. [El cerebro del corte: Claude + heurísticas](#6-el-cerebro-del-corte-claude--heurísticas)
7. [Transcripción con Whisper](#7-transcripción-con-whisper)
8. [Render con Remotion](#8-render-con-remotion)
9. [Compute on-demand: Vercel Sandbox](#9-compute-on-demand-vercel-sandbox)
10. [Async + retries: Inngest](#10-async--retries-inngest)
11. [Storage: Vercel Blob](#11-storage-vercel-blob)
12. [Base de datos: Postgres](#12-base-de-datos-postgres)
13. [Auth: Auth.js v5](#13-auth-authjs-v5)
14. [Exports: los 4 formatos editables](#14-exports-los-4-formatos-editables)
15. [El editor visual](#15-el-editor-visual)
16. [Operación: PM2, OIDC, watchdogs](#16-operación-pm2-oidc-watchdogs)
17. [Decisiones no negociables](#17-decisiones-no-negociables)
18. [Performance — los números reales](#18-performance--los-números-reales)
19. [Trade-offs y limitaciones conocidas](#19-trade-offs-y-limitaciones-conocidas)
20. [Roadmap](#20-roadmap)

---

## 1. El problema que resuelve

### El contexto: edición de Reels/TikToks/Shorts para agencias

Una agencia de contenido digital típica tiene este flujo:

1. El cliente graba **clips crudos** con el celular o con cámara: 5 a 20
   tomas distintas del mismo mensaje, cada una de 30 segundos a 3 minutos.
2. Manda los clips al editor de la agencia con un brief: "quiero un Reel
   de 60 segundos hablando sobre [X], punchy, con subtítulos animados".
3. El editor abre Premiere/CapCut/DaVinci y empieza el proceso manual:
   - Mirar cada clip y descartar tomas malas (titubeos, ruido, error)
   - Elegir las mejores tomas de cada idea
   - Recortar silencios entre frases
   - Encadenarlas en el orden correcto
   - Transcribir cada palabra y sincronizarla con animación
   - Exportar el MP4 final en formato vertical
4. Tiempo total: **3 a 6 horas** por un Reel de 60 segundos.

### El costo real

Para una agencia que produce 50 Reels al mes:

- **150 a 300 horas de editor profesional** mensuales solo en la edición
  mecánica (sin contar las decisiones creativas reales).
- Las primeras 2 horas son creativas (qué incluir, qué resaltar). El
  resto (1-4 horas) es trabajo repetitivo: recortar silencios, sincronizar
  subtítulos palabra por palabra, exportar a varios formatos para varias
  plataformas.

Eso es lo que VideoIA Agency automatiza. La meta no es reemplazar al
editor humano — es **liberarlo del trabajo mecánico** para que invierta
su tiempo en las decisiones creativas.

### Qué automatiza específicamente

| Tarea manual | Tiempo manual típico | Resuelto por |
|---|---|---|
| Transcribir cada clip palabra por palabra | 20-40 min | Whisper API |
| Identificar tomas buenas vs erradas | 10-20 min | Claude Sonnet 4.5 |
| Decidir orden narrativo de los snippets | 10-20 min | Claude Sonnet 4.5 |
| Recortar silencios entre frases | 30-60 min | FFmpeg + plan de Claude |
| Concatenar snippets con cortes limpios | 15-30 min | FFmpeg en Vercel Sandbox |
| Generar subtítulos animados sincronizados | 30-60 min | Remotion |
| Exportar a Premiere/DaVinci/CapCut/SRT | 15-30 min | Generadores de project files |
| **Total automatizable** | **2-4 horas** | **5-12 minutos de pipeline** |

El editor humano sigue interviniendo cuando quiere — para eso existe
el [editor visual](#15-el-editor-visual) en la app: timeline, snippets,
estilo de subs, undo/redo, etc. Pero arranca de un punto que está al
90% terminado, no del clip crudo.

---

## 2. Cómo funciona — visión funcional

### Inputs

El cliente provee:

1. **Clips crudos** (1 a 20 archivos .MP4/.MOV, hasta varios GB total)
2. **Brief en texto** (1-3 párrafos): tono, audiencia, objetivo, mensaje clave
3. **Guión opcional**: si querés que el video siga un script exacto, cada
   línea del guión debe poder mapearse a un tramo de algún clip
4. **Perfil del cliente** (configurado una vez): preferencias de subtítulos
   (fuente, color, animación, posición), formatos de export (9:16, 1:1, 16:9),
   redes objetivo (Reels, TikTok, Shorts, Stories), config de silencio

### Outputs

La app entrega:

1. **MP4 final** (`outputs/{projectId}.mp4`): el video editado, opcionalmente
   con subtítulos animados quemados.
2. **Premiere XML** (`proyectos-xml/{id}.xml`): FCP7 XML que Premiere Pro
   importa nativamente como secuencia con cortes ya aplicados.
3. **DaVinci EDL** (`proyectos-edl/{id}.edl`): formato CMX 3600 para DaVinci
   Resolve.
4. **CapCut ZIP** (`proyectos-capcut/{id}.zip`): contiene
   `draft_content.json` + `draft_meta_info.json` + README + script para
   descargar los clips. Importable como proyecto CapCut Desktop.
5. **SRT** (`proyectos-srt/{id}.srt`): subtítulos universales para YouTube,
   Premiere, etc.

### Flujo del usuario

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. Login en /login (o signup en /signup si es primer ingreso)      │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ 2. /dashboard/proyectos/nuevo                                      │
│    - Subir N clips (drag-drop, sube a Vercel Blob)                 │
│    - Escribir brief                                                │
│    - (Opcional) Subir guión: .txt, .docx, .pdf                     │
│    - (Opcional) Personalizar subs (override del perfil cliente)    │
│    - (Opcional) Activar render con subs quemados                   │
│    - (Opcional) Activar embed de clips en ZIP CapCut               │
│    - Submit → POST /api/pipeline                                   │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Encola evento Inngest
┌────────────────────────────────────────────────────────────────────┐
│ 3. Pipeline async (5-12 min). Ver capítulo 5 para detalle de steps.│
│    UI hace polling cada 3s a /api/pipeline/[id]/status              │
│    El usuario ve cronómetro en vivo del step actual.                │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ status = "completed"
┌────────────────────────────────────────────────────────────────────┐
│ 4. /dashboard/proyectos/[id] muestra los outputs descargables       │
│    - MP4 final                                                      │
│    - XML / EDL / CapCut ZIP / SRT                                   │
│    - Botón "Abrir editor" si es multiclip                          │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Opcional
┌────────────────────────────────────────────────────────────────────┐
│ 5. /dashboard/proyectos/[id]/editor — editor visual                 │
│    - Reordenar snippets, recortar in/out                            │
│    - Editar texto de subs palabra por palabra                       │
│    - Cambiar fuente/color/animación                                 │
│    - Re-render final o re-generar editables                         │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Arquitectura técnica — vista 30,000 pies

```
┌───────────────────────────────────────────────────────────────────┐
│                      Cliente (browser)                            │
│         Next.js App Router + React 19 + Tailwind 4                │
│         Remotion Player (preview live en editor visual)           │
└────────────────────────┬──────────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌───────────────────────────────────────────────────────────────────┐
│              Next.js Server (api routes + ISR)                    │
│  - Endpoints REST/JSON (CRUD, control de pipeline)                │
│  - Auth.js v5 (cookies JWT, middleware basado en cookies)         │
│  - Rate limiting opcional (Upstash)                               │
└──┬────────────────┬───────────────────────┬───────────────────────┘
   │                │                       │
   ▼                ▼                       ▼
┌────────┐ ┌──────────────────┐ ┌──────────────────────────────────┐
│ Postgres│ │   Vercel Blob    │ │          Inngest                 │
│ (Neon) │ │  (storage objetos)│ │  (cola de jobs async + retries)  │
│        │ │                  │ │                                  │
│ tablas:│ │  paths:          │ │  events:                         │
│ users  │ │  footage/        │ │  pipeline/multiclip-run          │
│ clientes│ │  audios-multi/   │ │  pipeline/multiclip-replan       │
│ proyectos│ │  transcripciones/│ │  pipeline/multiclip-rerender     │
│ cortes │ │  intermedio-multi/│ │  pipeline/cortes-run             │
│ montajes│ │  outputs/        │ │  pipeline/run                    │
│        │ │  proyectos-xml/  │ │  cortar/run                      │
│        │ │  proyectos-edl/  │ │  montaje/run                     │
│        │ │  proyectos-capcut│ │                                  │
│        │ │  proyectos-srt/  │ └────────────────┬─────────────────┘
└────────┘ └──────────────────┘                  │
                                                  │ webhook
                                                  ▼
                                  ┌──────────────────────────────┐
                                  │  Inngest function runner     │
                                  │  (corre dentro de Next via   │
                                  │   POST /api/inngest)         │
                                  │                              │
                                  │  Cada función tiene N steps  │
                                  │  con retries automáticos     │
                                  └──┬───────────────────────────┘
                                     │
                          ┌──────────┼──────────────┐
                          ▼          ▼              ▼
                  ┌──────────┐ ┌──────────┐ ┌─────────────────┐
                  │ Anthropic│ │ OpenAI   │ │ Vercel Sandbox  │
                  │   API    │ │  Whisper │ │ (compute on-    │
                  │ (Claude  │ │   API    │ │  demand)        │
                  │ Sonnet   │ │          │ │                 │
                  │ 4.5)     │ │          │ │ FFmpeg, curl,   │
                  └──────────┘ └──────────┘ │ Remotion render │
                                            └─────────────────┘
```

**Por qué este shape:**

- **Next.js como puerta de entrada**: una sola app fullstack (no se separa
  frontend/backend) reduce overhead deploy. El editor visual con Remotion
  Player + el dashboard + las API routes están todas en el mismo bundle.

- **Inngest fuera del request HTTP**: los pipelines tardan 5-12 minutos.
  Un request HTTP de Vercel tiene 300s de max — no llegamos. Inngest es
  el orquestador async que recibe el evento, corre la función paso a
  paso, persiste el estado de cada step, y reintenta automáticamente
  si algo falla.

- **Vercel Sandbox para trabajo pesado**: FFmpeg necesita CPU/disco. Una
  API route no es el lugar. El Sandbox tiene 4 vCPUs y disco SSD
  efímero ilimitado por job. Cada step lo crea, hace su trabajo, y lo
  apaga (`shutdown()` en `finally`).

- **Blob storage para todo binario**: los clips crudos, los audios
  intermedios, los video unidos, los outputs MP4, los project files
  (XML/EDL/ZIP/SRT). Postgres solo guarda metadata + JSONB de configs.

- **Postgres para estado y metadata**: tablas chicas, queries directas
  con `@vercel/postgres`. JSONB para estructuras complejas (clips,
  plan_multiclip, progress, subtitulosOverride).

---

## 4. Stack en detalle

### Por qué cada elección

#### Next.js 15 App Router + React 19 + TypeScript estricto

- **App Router** sobre Pages: necesitamos server components para cargar
  datos sin client-side fetch (más rápido el primer paint), y mantener
  el editor visual como client component aislado donde lo necesitamos.
- **TypeScript estricto** (`strict: true`, sin `any` implícito): un
  pipeline de video con 7 stages encadenadas tiene mil tipos pasando
  entre funciones. Sin tipos estrictos, los bugs migran de un step a
  otro sin que nadie los note hasta producción.
- **React 19** porque viene incluido en Next 15 y soportamos su SDK.

**Alternativa que descartamos**: Astro o Remix. Ambos son más livianos
pero el editor visual necesita state management complejo (undo/redo,
playerRef sincronizado, varias tabs interactuando). Next + React es lo
más maduro para eso.

#### Tailwind 4

- Estilos co-locados en JSX, sin archivos `.module.css` separados.
- `@tailwindcss/postcss` para builds rápidos.
- Componentes UI propios (`Card`, `Badge`, `Input`, `Button`) con
  variantes vía clases.

#### Claude Sonnet 4.5 (Anthropic SDK)

- **Por qué Claude y no GPT-4**: el planning del video es un problema de
  razonamiento sobre texto largo (transcripciones de 5-20 min de habla).
  Claude Sonnet 4.5 tiene mejor performance en tareas de
  análisis-de-texto-largo + reasoning chains.
- **Por qué Sonnet (no Opus ni Haiku)**: Opus es 5× más caro y la mejora
  marginal en esta tarea no la justifica. Haiku no logra suficiente
  calidad de razonamiento.
- **Cliente con timeout 270s**: el max del request en Vercel es 300s.
  Si llega Claude justo después de eso, el sandbox ya cayó. 270s da
  margen.

**Alternativa que descartamos**: GPT-4o. Probado en early iteración,
hacía cortes a mitad de palabra más seguido que Claude porque
inventaba timestamps con más libertad. Con el [refactor a índices de
palabra](#planning-por-índices-de-palabra) este problema casi
desaparece, pero Claude sigue ganando en consistencia con instrucciones
estructuradas.

#### Whisper API (OpenAI SDK)

- **Por qué Whisper API y no Whisper local**: Whisper local requiere
  GPU para ser rápido. El servidor (Vercel functions) no tiene GPU. La
  API de OpenAI lo resuelve por nosotros con 30s para audios de varios
  minutos.
- **`response_format: "verbose_json"` + `timestamp_granularities: ["word"]`**:
  pedimos timestamps **por palabra**, no por frase. Es la base de todo el
  sistema de cortes — sin word-level timestamps no podemos hacer "snap a
  palabra entera".
- **`language: "es"`**: hardcodeado por ahora. Whisper auto-detecta pero
  forzar el idioma es más preciso para español (evita confundir con
  catalán o portugués).

#### Remotion 4 (`@remotion/vercel`)

- **Por qué Remotion y no FFmpeg drawtext**: drawtext es estático — no
  permite animaciones por palabra (spring, pop-scale, karaoke). Para
  Reels/TikToks profesionales los subtítulos animados son **el**
  diferenciador visual. Remotion renderiza React/CSS a video, con
  animaciones primera-clase.
- **`@remotion/vercel`**: ejecuta el render dentro de Vercel Sandbox
  (Chromium headless + ffmpeg). El bundle de la composition Remotion
  está pre-bundleado en build-time (`./build/`) y se inyecta al sandbox.
- **Player en cliente**: el editor visual usa `@remotion/player` para
  preview en browser sin renderizar — usa el mismo componente
  `MulticlipComposition` que el render server.

**Alternativa que descartamos**: `@remotion/lambda` (AWS). Más rápido
para renders en paralelo pero requiere setup AWS por proyecto.
`@remotion/vercel` es plug-and-play.

#### Vercel Sandbox (`@vercel/sandbox`)

- **Por qué Sandbox y no AWS Lambda / Cloud Run**: Lambda tiene 15min
  max de ejecución y limitaciones de disco (512MB tmp por default).
  Sandbox tiene timeout configurable (hasta 30min en nuestros pipelines)
  y disco SSD efímero ilimitado. Además vive en la misma red que las
  Vercel Functions — latencia mínima.
- **`runtime: "node22"`, `vcpus: 4`**: estándar. 4 vCPUs es lo mínimo
  para que ffmpeg con `-threads 2` no compita por CPU con el resto del
  sistema.
- **Setup en cada arranque**: `npm install ffmpeg-static @vercel/blob` +
  wrapper para `/tmp/bin/ffmpeg`. El sandbox empieza limpio en cada job
  — no hay imagen pre-construida.

#### Inngest 3.x

- **Por qué Inngest y no BullMQ + Redis directo**: Inngest da retries
  automáticos, persistencia de step state, observabilidad (dashboard
  web), reintentos exponenciales y un dev server local que mockea
  todo. Construir esto encima de BullMQ requiere 2-3 semanas de
  ingeniería.
- **Steps con `step.run()` en lugar de `await`**: cada step se persiste
  en Inngest. Si el segundo step falla, Inngest no re-corre el primero
  — usa el resultado cacheado. Eso ahorra ~70% del tiempo de retry en
  pipelines largos.
- **Concurrency limit por función**: `procesarMulticlipProyecto` tiene
  `concurrency: { limit: 3 }` para no saturar Vercel Sandbox cuando
  varios usuarios crean proyectos a la vez.

#### Vercel Blob (`@vercel/blob` 2.3.3)

- **Por qué Blob y no S3 directo**: integración nativa con Vercel
  Functions (auto-inyección de `BLOB_READ_WRITE_TOKEN`). Multipart
  upload built-in para archivos grandes. URLs públicas con CDN
  global. Costos predecibles.
- **`access: "public"` + `allowOverwrite: true`**: los outputs son
  públicos (no manejamos sesiones para los URLs de descarga). Overwrite
  porque los reintentos del pipeline pueden re-subir el mismo path.

#### Vercel Postgres (Neon)

- **Por qué Postgres y no MongoDB**: necesitamos joins limpios (proyectos
  ↔ clientes ↔ users) y constraints fuertes (CHECK en render_method).
  JSONB cubre los casos donde necesitamos flexibilidad sin perder
  relacional.
- **`@vercel/postgres` con tagged template literals**: SQL inline en el
  código (`sql\`SELECT * FROM proyectos WHERE id = ${id}\``). Sin ORM —
  el shape de las queries es predecible, los tipos vienen del rowToProyecto
  manual.

**Alternativa que descartamos**: Prisma. ORMs son ineficientes para
queries específicas (las que devuelven solo 3 columnas con UN join).
Y agregan otra capa de mantenimiento.

#### Auth.js v5 beta (NextAuth)

- **Credentials provider** con email/password en `users` table.
- **Bcrypt** para hashing (`@bcryptjs`).
- **JWT sessions** (no DB sessions) — más simple, sin tabla extra.
- **Middleware basado en cookies** en lugar de JWT decode: el Edge
  Runtime de Next 15 no soporta JWT decode complejo en middleware sin
  exclusiones. Cookie check es 10× más rápido.

#### Upstash Ratelimit (opcional)

- Rate limit por IP en POST `/api/pipeline` (encolar proyecto).
- Si las env vars de Upstash no están, el ratelimit se **deshabilita
  silenciosamente** (sin romper la app). Útil para dev local sin
  Upstash configurado.

---

## 5. Los pipelines (Inngest functions)

7 funciones registradas en
[`app/api/inngest/route.ts`](../app/api/inngest/route.ts). Cada una
escucha un evento distinto y corre N steps con retries automáticos.

### 5.1 `procesarMulticlipProyecto` — el path principal

**Archivo**:
[`inngest/functions/proyecto-multiclip.ts`](../inngest/functions/proyecto-multiclip.ts)
**Evento**: `pipeline/multiclip-run`
**Concurrency**: 3 jobs en paralelo max
**Retries**: 2
**Tiempo típico** (16 clips × 60 MB): 5-12 min según opciones

#### Steps detallados

```
STEP 0 — preflight (~3s)
├─ Verifica BLOB_READ_WRITE_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY
├─ HEAD a cada URL de clip para confirmar que existe y devuelve 200
└─ Fail fast: si algo falla acá, ahorramos 5-10 min de pipeline.

STEP 1 — analyze-clips (~2-3 min para 16 clips)
├─ Crea un Vercel Sandbox
├─ DESCARGA EN PARALELO (xargs -P 4) los N clips de Blob al sandbox
├─ Loop secuencial: por cada clip, extrae metadata (ffprobe) + extrae
│  audio mp3 (ffmpeg -vn) + sube el mp3 a Blob
├─ Heartbeat cada 30s para que el watchdog no mate el job
└─ shutdown() del sandbox en finally

STEP 2 — transcribe-clips (~1-2 min para 16 clips)
├─ Whisper en PARALELO con concurrency 3 — pool de workers
├─ Por cada clip: fetch del mp3 desde Blob → Whisper API → JSON con
│  words: [{ start, end, word }]
├─ Concatena todos los JSON: WordTimestamp[][]
└─ Upload a Blob: transcripciones-multiclip/{projectId}.json

STEP 3 — claude-multiclip (~30-60s)
├─ Construye el prompt con las transcripciones numeradas (W0001, W0002...)
├─ Llama Claude Sonnet 4.5 (timeout 270s, max_tokens 4096)
├─ Parsea respuesta JSON: { snippets, ideas, enfasisPalabras, ... }
├─ Normaliza snippets:
│   1. Si vienen con firstWordIdx/lastWordIdx → resolver a start/end de palabras reales
│   2. Trim de muletillas en bordes (25+ palabras-señal reconocidas)
│   3. Filtrar duración mínima 1.0s
│   4. Merge de snippets contiguos del mismo clip (gap < 0.25s)
│   5. Split de snippets con silencio interno > 0.8s
└─ Devuelve PlanMulticlip

STEP 4 — ffmpeg-multiclip-concat (~1-2 min para 16 clips)
├─ Crea un Sandbox nuevo (el del step 1 ya murió)
├─ Descarga TODOS los clips en paralelo (xargs -P 4)
├─ Two-pass concat:
│   Pass 1: por cada snippet, ffmpeg -ss start -t dur -vf "scale+pad+setsar"
│           -af "afade+aresample" → /tmp/segments/seg_NNN.mp4
│   Pass 2: ffmpeg -f concat -i list.txt -c copy → /tmp/video_unido.mp4
├─ Upload video_unido a Blob: intermedio-multiclip/{projectId}.mp4
└─ shutdown()

STEP 5 — adjust-transcripcion-multiclip (~1s, sin sandbox)
├─ Lee transcripciones per-clip + plan_multiclip
├─ Para cada snippet: extrae las words que caen adentro, ajusta sus
│  timestamps al timeline final
└─ Upload: transcripciones-multiclip-final/{projectId}.json

STEP 6 — generate-multiclip-exports (~30s sin embed, 5-15 min con embed)
├─ Construye Premiere XML con cumulative timeline
├─ Construye DaVinci EDL con timecodes
├─ Construye CapCut draft (draft_content.json + draft_meta_info.json)
├─ Genera SRT agrupado por palabras_por_linea
├─ Si incluir_clips_en_zip = true: descarga TODOS los clips y los mete
│  al ZIP. Si false (default): mete solo README + script de descarga.
└─ Upload de los 4 archivos en paralelo

STEP 7 (opcional, solo si renderSubtitulos=true) — final-render
├─ Crea Sandbox con timeout 30min
├─ addBundleToSandbox: inyecta el bundle Remotion pre-buildeado
├─ renderMediaOnVercel: Remotion renderiza el MP4 con subs animados
│  encima del video_unido (h264, codec por defecto)
├─ Tiempo: 5-15 min según duración del video final
├─ Upload: outputs/{projectId}.mp4
└─ shutdown()

STEP 8 — mark-completed
└─ UPDATE proyectos SET status='completed', outputUrl=..., ...
```

#### Decisiones clave del pipeline multiclip

1. **Whisper paralelo concurrency 3, no más**: OpenAI Whisper API tiene
   rate limit de 50 req/min para Whisper-1. Con 3 paralelos estamos
   lejos del límite. Más paralelos = riesgo de rate limit 429.

2. **Sandbox separado por step**: cada step (analyze, concat, render)
   crea su propio sandbox. Eso ahorra los re-uploads entre steps porque
   cada sandbox sube su output a Blob, no comparte estado.

3. **Two-pass concat en lugar de filter_complex monolítico**: el
   filter_complex con 16 inputs explota el heap de ffmpeg (exit 137 =
   OOM por SIGKILL del kernel). Two-pass = un ffmpeg por snippet (poco
   RAM cada uno) + un concat demuxer al final (sin re-encode, casi
   instantáneo).

4. **Heartbeat cada 30s**: `startHeartbeat(projectId)` hace
   `updateProject` con el `progress` cada 30s mientras el step trabaja.
   El watchdog (`scripts/stuck-pipeline-cron.js`) mata pipelines cuyo
   `updated_at` no se movió en 8 minutos.

### 5.2 `procesarCortesProyecto` — para 1 clip largo

**Archivo**:
[`inngest/functions/proyecto-cortes.ts`](../inngest/functions/proyecto-cortes.ts)
**Evento**: `pipeline/cortes-run`
**Cuándo se usa**: cliente sube UN clip largo (entrevista de 20 min,
podcast de 60 min) y quiere que la IA decida qué cortar.

#### Diferencias con multiclip

- Recibe `footageUrl` único, no `clips[]`.
- Claude analiza el clip completo + silencios detectados por ffmpeg
  silencedetect (no solo silencios entre palabras Whisper).
- Devuelve un array de "cortes" (lo que **eliminar**) en lugar de
  "snippets" (lo que **mantener**). La inversión la hace el código.
- Más estricto con repeticiones porque un podcast tiene mucho más
  contenido redundante que 16 reels chicos.

### 5.3 `procesarVideo` — modo "original" o "mirage"

**Archivo**:
[`inngest/functions/pipeline.ts`](../inngest/functions/pipeline.ts)
**Evento**: `pipeline/run`
**Cuándo se usa**: 1 clip, render simple. Sin reordenamiento.

#### Modos

- **`renderMethod: "original"`**: pipeline simple — analyze + Whisper +
  Claude (solo decide énfasis, no cortes) + render Remotion.
- **`renderMethod: "mirage"`**: usa Captions.ai como render engine.
  Mucho más rápido (30-60s) pero limitado: solo formato 9:16, max
  50MB de input, max 1min de duración. No editamos los subs después.

### 5.4 `cortarSilencios` — módulo independiente

**Archivo**:
[`inngest/functions/cortar-silencios.ts`](../inngest/functions/cortar-silencios.ts)
**Evento**: `cortar/run`
**Cuándo se usa**: el editor quiere SOLO los project files (XML/EDL/
CapCut) para hacer el cut manual después. No quiere MP4 final ni
subtítulos.

Sin Claude, sin Whisper, sin Remotion. Solo:
1. Detección de silencios con `silencedetect` de ffmpeg
2. Cálculo de "keep segments" (inverso de los silencios)
3. Generación de XML/EDL/CapCut con esos cortes

Tabla independiente `cortes` (no usa `proyectos`).

### 5.5 `procesarMontaje` — módulo Montaje automático

**Archivo**:
[`inngest/functions/montaje.ts`](../inngest/functions/montaje.ts)
**Evento**: `montaje/run`
**Cuándo se usa**: variante del 5.4 pero entrega el MP4 final ya cortado
+ montado (no solo los project files). Usa `ffmpeg-static` directamente
en el proceso de Node, no en Sandbox — útil para clips chicos donde
el overhead del Sandbox no vale la pena.

### 5.6 `rerenderizarMulticlipFinal` — re-render desde el editor

**Archivo**:
[`inngest/functions/proyecto-multiclip.ts`](../inngest/functions/proyecto-multiclip.ts)
**Evento**: `pipeline/multiclip-rerender`
**Cuándo se usa**: en el editor visual, el usuario edita y aprieta
"Re-render final". Re-arma video_unido + exports + opcional MP4
quemado con el plan_multiclip EDITADO. NO re-corre analyze + transcribe
+ Claude (ahorra 5+ min).

### 5.7 `replanificarMulticlipFinal` — re-ejecutar Claude

**Archivo**:
[`inngest/functions/proyecto-multiclip.ts`](../inngest/functions/proyecto-multiclip.ts)
**Evento**: `pipeline/multiclip-replan`
**Cuándo se usa**: cuando mejoramos el prompt de Claude o las
heurísticas del planning, podemos re-ejecutar SOLO el step de Claude
contra las transcripciones ya persistidas, sin re-procesar clips.
Después dispara `pipeline/multiclip-rerender` automáticamente.

---

## 6. El cerebro del corte: Claude + heurísticas

### Por qué la calidad del corte es lo más difícil

Este es el corazón del producto. Si Claude elige mal qué cortar:
- El video deja silencios largos sin remover
- Se cortan palabras a la mitad
- Se repiten ideas
- Se incluyen errores y autocorrecciones

Por eso esta sección tiene mucha más profundidad que las otras.

### Planning por índices de palabra

**El problema con timestamps**: si le pedís a Claude "devolveme `{ start, end }` en segundos", inventa números que parecen razonables pero
no calzan con palabras reales de Whisper. Ejemplo: la palabra "hola"
va de `2.30s` a `2.65s` y Claude pide `end: 2.5s` → ffmpeg corta la
palabra a la mitad.

**La solución**: cambiar el formato del plan a **índices de palabra**.
La transcripción que ve Claude está numerada:

```
[W0042   3.45-3.82]  "hola"
[W0043   3.85-4.20]  "qué"
[W0044   4.22-4.55]  "tal"
>>> SILENCIO LARGO 1.20s entre W0044 y W0045 — CORTE OBLIGATORIO <<<
[W0045   5.75-6.10]  "como"
```

Claude responde:

```json
{
  "snippets": [
    { "clipIndex": 0, "firstWordIdx": 42, "lastWordIdx": 44, "razon": "saludo limpio" },
    { "clipIndex": 0, "firstWordIdx": 45, "lastWordIdx": 68, "razon": "..." }
  ]
}
```

Y nosotros derivamos start/end de la transcripción REAL:

```ts
const first = clip.transcripcion[42]; // start: 3.45
const last = clip.transcripcion[44];  // end: 4.55
const snippetStart = first.start - START_PAD_SEC; // 3.45 - 0.08 = 3.37
const snippetEnd = last.end + END_PAD_SEC;        // 4.55 + 0.18 = 4.73
```

Por construcción es imposible cortar a mitad de palabra.

### El prompt — qué le pedimos exactamente

Archivo: [`lib/anthropic-multiclip.ts:89`](../lib/anthropic-multiclip.ts).
Estructura general:

```
1. Rol: "Sos editor profesional senior de Reels/TikToks/Shorts (10+ años)"
2. Sistema: explicar el formato de selección por índice
3. Proceso mental obligatorio (5 pasos):
   a. Leer transcripciones completas
   b. Enumerar las 3-8 IDEAS NUCLEARES
   c. Por cada idea, elegir la mejor toma
   d. Definir firstWordIdx/lastWordIdx
   e. Verificar concatenación leyéndola mentalmente
4. Reglas estrictas (A-G):
   - A) Silencios: cada SILENCIO LARGO obliga a cortar
   - B) Repeticiones: una idea, una sola aparición
   - C) Errores: 20+ palabras-señal listadas (perdón, espera, así no, ...)
   - D) Muletillas: tolerancia cero al inicio del snippet
   - E) Fragmentos incompletos
   - F) Granularidad (min 1s, max 12s)
   - G) Orden narrativo (con guión / sin guión)
5. Duración objetivo: 20-60s típico
6. Brief del cliente + guión + transcripciones
7. Formato de respuesta JSON (con ideas, snippets, enfasisPalabras, ...)
```

### Chain-of-thought obligatorio

El prompt **obliga** a Claude a enumerar primero las IDEAS NUCLEARES
del video antes de elegir snippets. Esto soluciona dos problemas:

1. **Repeticiones**: si Claude ya nombró "Idea 3: solución H-D-C", no
   va a incluir dos snippets que ambos digan la solución. Sabe que la
   idea está "ocupada".

2. **Coherencia narrativa**: al enumerar primero las ideas y después
   asignar tramos, el orden final tiene sentido. Sin esto, Claude tiende
   a ir clip por clip incluyendo todo lo "bueno" sin pensar en cómo
   conecta.

Las `ideas` vuelven en la respuesta. El sistema podría validar
post-Claude que no haya duplicados semánticos (todavía no se hace,
está en roadmap).

### Post-procesamiento — el "safety net"

Después de recibir el plan, [`normalizeSnippets`](../lib/anthropic-multiclip.ts)
hace 5 passes:

1. **Resolver índices a timestamps**: para cada snippet, mira
   `transcripcion[firstWordIdx]` y `transcripcion[lastWordIdx]` y
   deriva start/end aplicando padding (`START_PAD_SEC=0.08`,
   `END_PAD_SEC=0.18`).

2. **Trim de muletillas en bordes**: si el snippet arranca o termina
   con alguna de las 25+ muletillas reconocidas (`"eh"`, `"este"`,
   `"perdón"`, `"pará"`, `"ay"`, etc.), recorta hasta 3 palabras del
   inicio y 3 del final.

3. **Filtro de duración mínima 1.0s**: snippets de menos de 1s casi
   siempre son muletillas sueltas o fragmentos rotos.

4. **Merge contiguous**: si dos snippets consecutivos son del mismo
   clip y el gap entre ellos es < 0.25s, los junta en uno (evita cortes
   "secos" en una conversación fluida).

5. **Split en silencios internos**: si un snippet contiene un gap > 0.8s
   entre palabras consecutivas (silencio largo interno), lo parte en dos.
   Cubre el caso donde Claude se equivoca y deja un silencio adentro.

### Las muletillas reconocidas

Lista completa en [`MULETILLAS_BORDE`](../lib/anthropic-multiclip.ts):

```
Relleno: eh, este, esto, bueno, entonces, tipo, ehh, ehhh, mmm, mm, ah
Correcciones: perdon, perdón, perdoname, perdoná, espera, esperá, ay,
              asi, así, dejame, déjame, uy, ups, pará, para
```

Solo se aplican en el **primero o último word** del snippet (no en el
medio, donde una muletilla suelta suena natural). Y solo recorta hasta
3 palabras (más que eso puede comerse el inicio real del contenido).

---

## 7. Transcripción con Whisper

### Archivo: [`lib/openai.ts`](../lib/openai.ts)

```ts
export async function transcribirConWhisperDesdeUrl(blobUrl: string): Promise<WordTimestamp[]> {
  const res = await fetch(blobUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = path.join(tmpdir(), `whisper-${randomUUID()}.mp3`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
      language: "es",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });
    return transcription.words.map((w) => ({
      texto: w.word.trim(),
      start: w.start,
      end: w.end,
      enfasis: false,
    }));
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
```

### Por qué archivo temp en lugar de stream directo

El SDK de OpenAI requiere un `ReadStream` con un path real para inferir
el content-type del archivo (multipart upload). Si pasamos un buffer
directo, falla con "unrecognized format".

UUID en el filename: si dos clips se transcriben en paralelo en la
misma function instance, `Date.now()` puede colisionar. UUID no.

### Concurrencia 3

El pipeline multiclip transcribe 3 clips a la vez usando un worker
pool manual (`Array.from({length: 3}, worker)`). OpenAI Whisper API
permite 50 req/min — con 3 paralelos estamos a 9-12 req/min en pico,
seguro lejos del rate limit.

---

## 8. Render con Remotion

### Tres composiciones, dos modos de uso

```
remotion/
├── Root.tsx                              # Registro de composiciones
├── compositions/
│   ├── VideoBase.tsx                     # Render server-side (1 video unido)
│   ├── MulticlipComposition.tsx          # Preview client + render multiclip
│   └── SubtitulosDinamicos.tsx           # Componente de subs (compartido)
└── index.ts                              # Entry point para el bundler
```

### `SubtitulosDinamicos.tsx` — el componente reutilizable

Recibe `transcripcion: WordTimestamp[]` + `config: ConfigSubtitulos` y
renderiza los subs sincronizados al frame actual del video. Soporta
**5 animaciones**:

| Animación | Comportamiento |
|---|---|
| `pop-scale` | Cada palabra aparece con spring scale 0 → 1.1 → 1 |
| `slide-up` | Palabra entra deslizándose desde abajo + fade |
| `typewriter` | Reveal carácter por carácter |
| `highlight` | Palabra aparece y se llena de fondo de color |
| `karaoke` | Línea visible, cada palabra cambia de color al hablarse |

Cada palabra tiene flag `enfasis: bool` que cambia su renderer (color
distinto + tamaño mayor). El plan de Claude define qué palabras
enfatizar (`enfasisPalabras: string[]`).

Las fuentes se cargan vía `@remotion/google-fonts` a nivel de módulo:
Montserrat, Bebas Neue, Inter, Poppins, Oswald, Roboto, Anton, Archivo
Black.

### `VideoBase.tsx` — render server-side

Composición que usa el `video_unido.mp4` ya pre-renderizado (el
output del step `ffmpeg-multiclip-concat`). Encima dibuja los
`SubtitulosDinamicos`. Es lo que renderiza el `final-render` step del
pipeline cuando `renderSubtitulos=true`.

### `MulticlipComposition.tsx` — preview client-side

**Acá está la magia del editor en vivo.** En lugar de usar
`video_unido.mp4`, RECONSTRUYE el video desde los clips originales:

```tsx
<AbsoluteFill style={{ backgroundColor: "black" }}>
  {sequences.map(({ from, durationInFrames, snippet }) => (
    <Sequence from={from} durationInFrames={durationInFrames}>
      <OffthreadVideo
        src={clips[snippet.clipIndex].url}
        startFrom={Math.round(snippet.start * fps)}
      />
    </Sequence>
  ))}
  <SubtitulosDinamicos ... />
</AbsoluteFill>
```

Cada `<Sequence>` toma un tramo del clip original via HTTP Range
request (Remotion solo descarga los bytes necesarios — magia de
`OffthreadVideo`). El usuario reordena snippets en el editor → el
preview refleja el cambio AL INSTANTE sin re-renderizar.

#### Bug histórico: drift de frames

Bug que tuvimos: el `cumulativeFrames` (suma de duraciones en frames
con Math.round) drifteaba contra el `durationInFrames` del Player
(Math.ceil de la suma de segundos). Para 16 snippets eso eran ~8
frames de gap al final donde ningún `<Sequence>` renderiza → pantalla
negra al hacer click cerca del final.

**Fix**: cumulative en SEGUNDOS (float) y derivar start/end frames con
`Math.round(cumulativeSec * fps)` consistente en ambos lados. Garantiza
`endFrame[i] === startFrame[i+1]` exacto, sin micro-gaps.

### `@remotion/vercel` — render en Sandbox

El paquete `@remotion/vercel` corre el render en Vercel Sandbox:

1. `createSandbox({ timeoutInMilliseconds: 30 * 60 * 1000 })` — 30min
   max porque renders multiclip largos pueden tomar 15min+.
2. `addBundleToSandbox({ bundleDir: "build" })` — inyecta el bundle
   Remotion pre-buildeado al sandbox.
3. `renderMediaOnVercel({ sandbox, compositionId: "VideoBase", inputProps })`
   — corre el render con Chromium headless + ffmpeg encoder.
4. Output: `/tmp/output.mp4` dentro del sandbox.
5. Upload del MP4 a Blob.

#### Pre-bundle en `./build/`

El bundle Remotion vive **committeado al repo** en `./build/`. Esto es
una decisión a propósito:

- Sin pre-bundle, cada deploy de Vercel tendría que correr
  `remotion bundle` (1-2min) que requiere Chromium + ffmpeg en el
  buildtime — no aplica en Vercel.
- Con pre-bundle: el bundle es estático y se sirve a las funciones
  Vercel como cualquier asset. Cuando hay un cambio en
  `remotion/compositions/`, hay que correr `npm run remotion:bundle`
  localmente y commitear `./build/` actualizado.

`next.config.ts` lo agrega como `outputFileTracingIncludes`.

---

## 9. Compute on-demand: Vercel Sandbox

### Por qué Sandbox y no otras opciones

| Opción | Pro | Contra | Veredicto |
|---|---|---|---|
| API route directa | Simple | Vercel functions max 300s, sin disk persistence, 4GB RAM hard | ❌ no alcanza para video |
| AWS Lambda | Maduro | 15min max, 512MB tmp por default, setup AWS por proyecto | ❌ engorroso |
| Cloud Run | Bueno | Cold start, latencia GCP↔Vercel, setup | ❌ no vale |
| **Vercel Sandbox** | Latencia mínima (Vercel→Vercel), 30min timeout, vcpus configurable, disk SSD efímero ilimitado, setup zero | API beta, costos por minuto | ✅ ideal |

### Setup del sandbox

[`lib/sandbox.ts`](../lib/sandbox.ts) tiene `createPreprocessSandbox()`:

```ts
const sandbox = await withNetworkRetry("Sandbox.create", () =>
  Sandbox.create({
    timeout: 1_800_000,        // 30 min
    runtime: "node22",
    resources: { vcpus: 4 },
  }),
);
```

Y después del create, instala lo necesario:

```bash
cd /tmp && npm install ffmpeg-static @vercel/blob 2>&1 | tail -2
FFMPEG_BIN=$(node -e "process.stdout.write(require('/tmp/node_modules/ffmpeg-static'))")
mkdir -p /tmp/bin
printf '#!/bin/sh\nexec "%s" "$@"\n' "$FFMPEG_BIN" > /tmp/bin/ffmpeg
chmod +x /tmp/bin/ffmpeg
```

#### Por qué un wrapper en `/tmp/bin/ffmpeg`

El sandbox `node22` no tiene root, no tiene `apt-get`. Instalamos
`ffmpeg-static` vía npm que descarga el binario a
`/tmp/node_modules/ffmpeg-static/ffmpeg.exe`. Ese path no está en `PATH`
por default. El wrapper en `/tmp/bin/ffmpeg` actúa como proxy — agregamos
`/tmp/bin:$PATH` antes de cada comando y todos los `ffmpeg ...` funcionan
transparentemente.

### Descargas paralelas con xargs

`downloadInSandboxBatch(sandbox, items, concurrency)` resuelve el
cuello de botella histórico:

**Antes** (secuencial): por cada clip, una llamada `downloadInSandbox(sandbox, url, dest)` que hacía un `curl` separado. Para 16 clips × 60s c/u = 16 min en serial.

**Después** (paralelo): un manifest TSV en `/tmp/dl-manifest.tsv` con
una línea `url<TAB>destpath` por archivo. Un script bash que lo procesa
con `xargs -P 4`:

```bash
xargs -a "$manifest" -d '\n' -L 1 -P 4 bash -c 'dl "$0"'
```

Resultado: 16 clips en 1-2 min en lugar de 16. **Mejora 8-10×**.

### `withNetworkRetry` para blips

Vercel Sandbox API a veces falla con `UND_ERR_SOCKET`, `terminated`,
`ECONNRESET` por blips de red transitorios entre nuestro Node y la
API de Vercel.

`withNetworkRetry(label, fn)` reintenta automáticamente 3 veces con
backoff exponencial (1s, 3s, 7s). Solo reintenta errores que matchean
patrones de red transitoria — no reintenta errores reales del comando
(exit code distinto de 0).

```ts
const TRANSIENT_NETWORK_PATTERNS = [
  "UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED",
  "ENOTFOUND", "EAI_AGAIN", "EPIPE", "terminated", "other side closed",
  "fetch failed",
];
```

### `shutdown()` en `finally` (regla #6 de AGENTS.md)

```ts
const sandbox = await createPreprocessSandbox();
try {
  // ... trabajo
} finally {
  await sandbox.stop();
}
```

Sin esto, los sandboxes quedan vivos consumiendo créditos hasta que
expira el timeout (30min). Si el step crashea o lanza una excepción,
el sandbox queda colgado.

---

## 10. Async + retries: Inngest

### Por qué Inngest específicamente

Para una aplicación que orquesta 5-12 minutos de trabajo distribuido
(Whisper, Claude, FFmpeg, Remotion, exports), necesitamos:

1. **Persistencia de step state**: si el step 4 falla, el reintento NO
   re-corre los steps 1-3.
2. **Retries automáticos** con backoff configurable por step.
3. **Visibilidad**: qué step está corriendo, en qué proyecto, hace
   cuánto.
4. **Dev local**: poder simular todo sin Vercel ni AWS.
5. **Concurrency control**: limitar cuántos jobs corren a la vez para
   no saturar Sandbox.

Construir esto encima de BullMQ + Redis lleva 2-3 semanas. Inngest da
todo plug-and-play en 10 minutos de setup.

### `step.run()` vs `await`

```ts
// MAL — fire-and-forget desde una API route. Si el server reinicia, se pierde.
const result = await algunaFuncionLarga();

// BIEN — paso registrado en Inngest. Si la función reinicia, Inngest
// recuerda el resultado y no lo re-ejecuta.
const result = await step.run("nombre-del-step", () => algunaFuncionLarga());
```

Cada `step.run()` se persiste en Inngest. Si la función crashea en el
step 5, el retry arranca desde el step 5 con los resultados de los 4
anteriores cacheados.

### Concurrency limit

```ts
export const procesarMulticlipProyecto = inngest.createFunction(
  {
    id: "procesar-multiclip-proyecto",
    retries: 2,
    concurrency: { limit: 3 },
  },
  { event: "pipeline/multiclip-run" },
  async ({ event, step }) => { /* ... */ },
);
```

Si llegan 10 eventos en simultáneo, Inngest corre 3 jobs en paralelo
y encola los otros 7. Evita saturar Vercel Sandbox cuando hay picos.

### Heartbeat + watchdog

Los pipelines largos (5-12min) corren la mayor parte del tiempo dentro
de UN solo `step.run()` (por ejemplo `analyze-clips` o `final-render`).
Si el sandbox muere a mitad del step pero la function HTTP request
sigue abierta esperando, Inngest no se entera hasta que el sandbox
timeout vence.

Para detectar esto antes:

1. **`startHeartbeat(projectId)`**: actualiza `proyectos.updated_at`
   cada 30s mientras el step trabaja.
2. **`scripts/stuck-pipeline-cron.js`**: corre en PM2 cada 2 minutos.
   Busca proyectos con `status='processing'` y `updated_at <
   NOW() - INTERVAL '8 minutes'`. Los marca como `error` con mensaje
   "Pipeline colgado >8 min".

El usuario ve el error rápido y puede reintentar, en lugar de esperar
30 minutos hasta que Inngest se rinda solo.

---

## 11. Storage: Vercel Blob

### Estructura de paths

Cada proyecto multiclip genera blobs en estos paths:

```
footage/{timestamp}-{name}-{shortid}.{ext}     # clips crudos subidos por el cliente
audios-multiclip/{projectId}/clip_{i}.mp3      # audio extraído por clip
transcripciones-multiclip/{projectId}.json     # WordTimestamp[][] (per-clip)
transcripciones-multiclip-final/{projectId}.json  # WordTimestamp[] (ajustado al timeline final)
intermedio-multiclip/{projectId}.mp4           # video_unido pre-render
outputs/{projectId}.mp4                        # MP4 final (con o sin subs quemados)
proyectos-xml/{projectId}.xml                  # Premiere XML
proyectos-edl/{projectId}.edl                  # DaVinci EDL
proyectos-capcut/{projectId}.zip               # CapCut draft ZIP
proyectos-srt/{projectId}.srt                  # SRT
```

Todos son `access: "public"`. La URL pública tiene formato:
`https://<tenant-id>.public.blob.vercel-storage.com/<path>`. El
tenant-id viene de la env var `BLOB_PUBLIC_BASE_URL`.

### `BLOB_READ_WRITE_TOKEN` server-side

Las funciones que escriben (`uploadToBlob`, `uploadFromSandboxToBlob`)
usan el token de escritura que está en env var. NUNCA se expone al
cliente.

### `allowOverwrite: true`

Los retries del pipeline pueden re-subir el mismo path (ej. si el step
`final-render` falla y se reintenta). Con `allowOverwrite: true`, Blob
no rechaza con "This blob already exists" — sobreescribe.

---

## 12. Base de datos: Postgres

### Schema actual

#### `users`
```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,           -- bcrypt hash
  name       TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `clientes`
```sql
CREATE TABLE clientes (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  perfil_json JSONB NOT NULL,          -- ClienteProfile entero (subs, formatos, silencio)
  created_at  TIMESTAMP DEFAULT NOW()
);
```

#### `proyectos`
```sql
CREATE TABLE proyectos (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  cliente_id            TEXT REFERENCES clientes(id),
  nombre                TEXT NOT NULL,
  brief                 TEXT NOT NULL,
  footage_url           TEXT NOT NULL,
  output_url            TEXT,
  status                TEXT DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','completed','error')),
  render_method         VARCHAR(20) NOT NULL DEFAULT 'original'
                        CHECK (render_method IN ('original', 'mirage', 'cortes', 'multiclip')),
  clickup_task_id       TEXT,
  error_message         TEXT,
  -- Pipeline 'cortes'
  xml_url               TEXT,
  edl_url               TEXT,
  capcut_url            TEXT,
  srt_url               TEXT,
  cortes_analysis       JSONB,
  keep_segments_count   INT DEFAULT 0,
  duracion_seg          REAL DEFAULT 0,
  -- Pipeline 'multiclip'
  clips                 JSONB,         -- ClipMultiSource[]
  guion                 TEXT,
  subtitulos_override   JSONB,         -- SubtitulosOverride por proyecto
  plan_multiclip        JSONB,         -- PlanMulticlip de Claude
  render_subtitulos     BOOLEAN NOT NULL DEFAULT false,
  incluir_clips_en_zip  BOOLEAN NOT NULL DEFAULT false,
  -- Estado vivo
  progress              JSONB,         -- { step, label, detail, startedAt, percent }
  -- Ownership
  user_id               TEXT,          -- nullable para filas pre-migración 0008
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_proyectos_cliente  ON proyectos(cliente_id);
CREATE INDEX idx_proyectos_status   ON proyectos(status);
CREATE INDEX idx_proyectos_clickup  ON proyectos(clickup_task_id);
CREATE INDEX idx_proyectos_user     ON proyectos(user_id);
```

#### `cortes` (módulo independiente, no usa proyectos)
Similar a proyectos pero sin Claude, Whisper, render Remotion.

#### `montajes` (módulo Montaje automático)
Schema simple: id, nombre, footage_url, video_final_url, status,
silencios_count, segments_count, duracion_original_seg,
duracion_final_seg.

### Por qué JSONB en lugar de tablas relacionales

- **`clips`**: array de N objetos con shape consistente. Hacer una
  tabla `proyecto_clips` con FK requiere joins para cargar el proyecto
  completo. JSONB lo trae junto sin overhead.
- **`plan_multiclip`**: estructura compleja con snippets, enfasisPalabras,
  animacionOverride, observaciones. Modelarla relacionalmente
  requeriría 3-4 tablas extra para algo que SIEMPRE se lee como bloque.
- **`subtitulos_override`**: partial de ClienteProfile.subtitulos, varía
  proyecto a proyecto. JSONB con shape opcional es perfecto.
- **`progress`**: snapshot del estado del step actual. Cambia cada 30s
  durante el pipeline. JSONB simple.

### Migrations idempotentes vía `/api/migrate`

[`app/api/migrate/route.ts`](../app/api/migrate/route.ts) tiene todas
las migrations inline en un array `runMigration("name", async () => sql\`...\`)`.

- Cada una usa `IF NOT EXISTS` o `ADD COLUMN IF NOT EXISTS`.
- Cada una corre en su propio try/catch — si una falla, las siguientes
  se intentan igual.
- Response devuelve `applied: string[]` y `failed: Array<{name, error}>`.
- Se invoca con `POST /api/migrate -H "x-admin-secret: $AUTH_SECRET"`.

Archivos `.sql` en `migrations/` son docs históricos pero **lo que
corre es el SQL inline en el route handler**.

### Por qué `user_id` nullable (migración 0008)

Antes de la migración 0008 los proyectos no tenían owner. Las filas
existentes en producción son del operador único (vos). Hacer la columna
NOT NULL rompería las filas viejas.

Decisión: nullable + queries filtran con `WHERE user_id = $1 OR user_id IS NULL`. Las filas legacy quedan visibles para el primer usuario
que las reclame. Filas nuevas siempre tienen user_id.

---

## 13. Auth: Auth.js v5

### Credentials provider con DB

[`auth.ts`](../auth.ts) configura un único provider: email/password
contra la tabla `users`. Bcrypt para hashing.

```ts
authorize(credentials) {
  const { rows } = await sql`SELECT id, email, name, password FROM users WHERE email = ${email}`;
  if (!await compare(password, rows[0].password)) return null;
  return { id, email, name };
}
```

### JWT sessions, no DB sessions

```ts
session: { strategy: "jwt" }
```

Por qué: no necesitamos tabla `sessions` extra. El JWT lleva el user_id
y es validado en cada request por NextAuth. Trade-off: si el usuario
cambia su password, las sesiones viejas siguen vivas hasta que expiran
(7 días por default). Acceptable para esta app.

### Middleware basado en cookies

[`middleware.ts`](../middleware.ts) es simple a propósito:

```ts
export function middleware(request: NextRequest) {
  const token = request.cookies.get("__Secure-authjs.session-token") ||
                request.cookies.get("authjs.session-token");
  if (!token) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}
```

**Por qué no decodificar el JWT en el middleware**: el Edge Runtime
de Next no soporta todas las dependencias que NextAuth usa para
decodificar JWT (jose, crypto.subtle con algoritmos custom). Cookie
check es 10× más rápido y suficiente — la API routes después validan
el token completo via `requireAuth()`.

### `requireAuth()` en cada route handler

[`lib/api-auth.ts`](../lib/api-auth.ts):

```ts
export async function requireAuth(): Promise<AuthedSession | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return { user: { id: session.user.id, email: ..., name: ... } };
}
```

Patrón en cada route:

```ts
export async function POST(req: Request) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session; // 401
  // ... usar session.user.id
}
```

**Excepciones** (rutas que NO usan `requireAuth` porque tienen su propia
autenticación):
- `/api/auth/*` — endpoints de NextAuth
- `/api/inngest` — webhook con firma propia
- `/api/webhooks/clickup` — HMAC propia
- `/api/migrate` — header `x-admin-secret`

---

## 14. Exports: los 4 formatos editables

Cada formato es un generador puro (no I/O) en `lib/`:

### Premiere XML — [`lib/premiere-xml.ts`](../lib/premiere-xml.ts)

Formato **FCP7 XML** (Final Cut Pro 7), que Premiere Pro importa como
secuencia con todas las cuts ya aplicadas. Es el formato más viejo y
universal de los editables.

Para el modo multiclip ([`lib/multiclip-exports.ts:generarPremiereXMLMulticlip`](../lib/multiclip-exports.ts)):
- 1 `<file id="file-source-N">` por clip
- 1 `<clipitem>` por snippet en la secuencia, con `<sourcetrack>` apuntando al file correspondiente
- Track de audio paralelo con el mismo split
- (Opcional) track de subtítulos como caption track

### DaVinci EDL — [`lib/davinci-edl.ts`](../lib/davinci-edl.ts)

Formato **CMX 3600**, estándar de la industria del cine para edición
offline. DaVinci Resolve lo importa nativamente.

Estructura: una línea por evento con timecodes (HH:MM:SS:FF), reel
name, channel (V o AA), in/out source, in/out timeline.

### CapCut draft — [`lib/capcut-draft.ts`](../lib/capcut-draft.ts) + [`lib/multiclip-exports.ts:generarCapCutDraftMulticlip`](../lib/multiclip-exports.ts)

Formato propio de CapCut Desktop: dos JSON archivos.

- **`draft_content.json`**: timeline completa con segments (video, audio, text),
  materials (video files, text styles), keyframes, effects.
- **`draft_meta_info.json`**: metadata del proyecto (nombre, dimensiones, fps).

Cuando el usuario abre el ZIP en CapCut, ve el proyecto **editable** con
los cortes ya aplicados.

#### Bug histórico: doble audio

Antes generábamos:
- 1 track de video con materials `type: "video"` (que YA traen audio
  embebido — `has_audio: true`)
- 1 track de audio separado con materials `type: "extract_music"`
  referenciando el MISMO archivo

Resultado: CapCut reproducía el audio dos veces overlap.

**Fix**: eliminado el track de audio separado. El video material trae
su audio, suena una sola vez. Si el usuario quiere editar audio aparte,
en CapCut existe el comando "Separate audio".

### SRT universal — [`lib/srt.ts`](../lib/srt.ts)

Formato más simple de todos:

```
1
00:00:00,000 --> 00:00:02,300
Hola amigos, cómo

2
00:00:02,400 --> 00:00:05,100
están hoy
```

Agrupa palabras según `subtitulos.palabras_por_linea` (default 4).
Importable en YouTube, Premiere, DaVinci, CapCut, VLC, KDEnlive, etc.

### Toggle: incluir clips dentro del ZIP CapCut

Por default, el ZIP CapCut pesa **~50 KB** (solo `draft_content.json` +
`draft_meta_info.json` + README + scripts de descarga). El usuario:

1. Extrae el ZIP en una carpeta
2. Corre `descargar-clips.sh` (macOS/Linux/WSL) o `descargar-clips.bat`
   (Windows) — los scripts hacen `curl` de los clips desde Vercel Blob
3. Abre el draft en CapCut — los clips aparecen al lado del JSON

Si el usuario activa `incluirClipsEnZip=true` al crear el proyecto, el
ZIP embebe los clips dentro. ZIP pesa los GB que pesen los clips y el
pipeline tarda 5-15 min más. La opción default ahorra ese tiempo
porque casi nunca es necesario.

---

## 15. El editor visual

### Acceso

`/dashboard/proyectos/[id]/editor` — botón "Abrir editor" en la página
del proyecto. Solo disponible para proyectos `multiclip` en estado
`completed`.

### Arquitectura

11 componentes en `components/proyectos/editor/`:

```
EditorClient.tsx          # entrypoint, state principal con undo/redo
├── EditorToolbar.tsx     # header: save, undo, redo, regenerate, rerender, resync
├── RemotionPreview.tsx   # wraps @remotion/player con MulticlipComposition
├── SubtitleOverlay.tsx   # overlay editable sobre el preview
├── SubtitleEditor.tsx    # panel: editar transcripción palabra por palabra
├── EnfasisEditor.tsx     # panel: editar enfasisPalabras (chips + sugerencias)
├── SnippetEditor.tsx     # panel: drag-drop snippets, TrimBar
├── StyleEditor.tsx       # panel: fuente, color, animación, posición
├── Timeline.tsx          # NLE timeline con 3 tracks (Video, Subs, Audio)
├── WaveformBar.tsx       # waveform vía wavesurfer.js
├── EditorStatusBar.tsx   # footer: tiempo, palabra activa, snippet activo, history
└── Toast.tsx             # stack de notificaciones
```

### `useEditorHistory` — undo/redo unificado

[`hooks/useEditorHistory.ts`](../hooks/useEditorHistory.ts):

```ts
const history = useEditorHistory<EditorState>({
  initial: { transcripcion, snippets, enfasisPalabras, subtitulosOverride },
  debounceMs: 800,
  maxHistorySize: 50,
});
const { state, setState, undo, redo, commit, canUndo, canRedo } = history;
```

#### Debounce de 800ms

`setState()` no commitea inmediatamente al stack — schedula un
`setTimeout(commit, 800)`. Si el usuario sigue editando (escribiendo
una palabra letra por letra), el commit se posterga. Resultado: UN
solo entry en el stack por "sesión de edición".

Sin esto, escribir "hola" generaba 4 entries (h, ho, hol, hola).

#### Bug histórico: dirty flag falso positivo

Antes:
```ts
const dirty = pastSize !== savedSize || futureSize > 0;
```

Bug: hacer Edit → Save → Edit → Undo dejaba el state actual igual al
guardado pero `futureSize > 0` → dirty=true. Botón "Guardar"
habilitado sin razón.

**Fix**: comparación por identidad referencial de cada slice del
EditorState:

```ts
const dirty = useMemo(() => {
  if (!savedSnapshot) return pastSize > 0;
  return (
    state.transcripcion !== savedSnapshot.transcripcion ||
    state.snippets !== savedSnapshot.snippets ||
    state.enfasisPalabras !== savedSnapshot.enfasisPalabras ||
    state.subtitulosOverride !== savedSnapshot.subtitulosOverride
  );
}, [state, savedSnapshot]);
```

`setEditorState` mantiene identidad de slices que no cambiaron (gracias
al spread `{ ...prev, transcripcion: ... }`). Undo a un commit guardado
recupera las mismas refs → dirty evalúa false correctamente.

### Tabs del sidebar

#### Subtítulos
Lista virtual de palabras (`SubtitleEditor`). Cada fila:
- Timestamp clickeable (salta al frame en el player)
- Texto editable inline
- start/end editables como `<input type="number">`
- Botones para insertar palabra después / borrar

Búsqueda en tiempo real por texto.

#### Énfasis
Chips de palabras (`EnfasisEditor`). Agregar/quitar. Auto-sugiere las
12 palabras más frecuentes de la transcripción que NO están ya en
énfasis.

#### Snippets
Reorder por drag-drop (`SnippetEditor`). Cada snippet tiene:
- Drag handle (≡) para arrastrar la fila completa
- `TrimBar` con dos handles arrastrables para recortar in/out (live —
  emite onChange cada 80ms durante el drag, no solo al soltar)
- Inputs numéricos para precisión exacta
- Botones up/down/delete

#### Estilo
Personalización por proyecto (`StyleEditor`) override del perfil
cliente: color base/énfasis, tamaños, fuente principal/énfasis,
animación, posición, palabras_por_linea, sombra. Estado "heredado" vs
"personalizado".

### Timeline NLE-style

`Timeline.tsx` — 3 tracks horizontales:

1. **Video** (indigo): cada snippet es un bloque arrastrable. Handles
   laterales para trim (live throttled a 80ms).
2. **Subs** (emerald): un bloque por palabra de la transcripción.
   Click salta al frame.
3. **Audio** (fuchsia): waveform decodificado por `wavesurfer.js` del
   `outputUrl` del proyecto. Sincronizado con el cursor del Player.
   Si los snippets se reordenan vs el video_unido original, se atenúa
   y muestra chip "Desincronizado — regenerá".

Cursor (playhead) vertical sincronizado al `frameupdate` del Remotion
Player. Click en el ruler hace seek.

### Acciones del toolbar

- **Guardar** (Ctrl+S): PATCH `/api/pipeline/[id]/editor` con
  `transcripcion`, `planMulticlip`, `subtitulosOverride`. La transcripción se
  sube a Blob, el plan se persiste en DB.
- **Regenerar editables**: POST `/api/pipeline/[id]/regenerate-editables`.
  Re-genera XML/EDL/CapCut/SRT con el estado actual SIN re-armar el video.
- **Re-sincronizar subs** (solo si hay drift): POST `/resync-transcripcion`.
  Re-deriva la transcripción ajustada desde las per-clip + plan actual.
  Pierde edits manuales de texto.
- **Re-render final**: POST `/api/pipeline/[id]/rerender-output`. Encola
  un job Inngest que re-arma video_unido + exports + opcional MP4 con subs
  quemados. Tiempo: 2-15 min.

### Atajos de teclado

- **Ctrl+Z**: undo
- **Ctrl+Y / Ctrl+Shift+Z**: redo
- **Ctrl+S**: save
- **Space**: play/pause
- **Escape**: deseleccionar palabra activa

---

## 16. Operación: PM2, OIDC, watchdogs

Esta sección es Windows-específica para dev local. En Vercel
production todo lo de PM2 no aplica.

### `ecosystem.config.js` — 4 procesos PM2

```
videoia-next         → Next dev server (puerto 3000)
videoia-inngest      → Inngest CLI dev (puerto 8288)
videoia-oidc-cron    → refresca VERCEL_OIDC_TOKEN cada 6h
videoia-stuck-cron   → mata pipelines stuck > 8min
```

#### Por qué PM2 y no `npm run dev` directo

- **Auto-restart**: si Next o Inngest crashean, PM2 los relevanta solo
  (hasta 10 intentos con backoff).
- **Logs separados** por proceso en `.pm2-logs/`.
- **Headless en Windows**: `windowsHide: true` evita que las ventanas
  de cmd aparezcan al iniciar.
- **`pm2 save`** persiste la config; `pm2 resurrect` la levanta al
  boot del sistema.

### El token OIDC y por qué expira

Vercel Sandbox requiere `VERCEL_OIDC_TOKEN` (un JWT firmado por Vercel)
para validar que el código que lo invoca es de un proyecto Vercel
legítimo. El token expira cada **~12 horas**.

En production: Vercel inyecta el token fresco en cada deploy.

En dev local: el token vive en `.env.local`. Hay que refrescarlo cada
12h. Sin esto, el primer pipeline después de 12h muere con
"Could not get credentials from OIDC context".

### `videoia-oidc-cron`

[`scripts/oidc-cron.js`](../scripts/oidc-cron.js) es un daemon que:

1. Al arrancar, ejecuta `scripts/refresh-oidc.ps1` una vez.
2. Cada **6 horas** lo vuelve a ejecutar.

`refresh-oidc.ps1`:
1. Hace backup de `.env.local` → `.env.local.bak`.
2. Corre `vercel env pull .env.vercel.fresh --environment=production`.
3. Extrae solo la línea `VERCEL_OIDC_TOKEN=...` del fresh.
4. Reemplaza esa línea en `.env.local` SIN tocar las demás vars.
5. Hace `pm2 restart videoia-next` para que el nuevo Next lea el token
   actualizado.

#### Por qué no Task Scheduler de Windows

Task Scheduler corre con environment limpio que no tiene las creds del
Vercel CLI (guardadas bajo `%APPDATA%\xdg.data\com.vercel.cli\auth.json`
con XDG_DATA_HOME). PM2 hereda las creds del shell que lo arrancó.

### `videoia-stuck-cron` — el watchdog

[`scripts/stuck-pipeline-cron.js`](../scripts/stuck-pipeline-cron.js)
corre cada **2 minutos**. Busca:

```sql
SELECT id FROM proyectos
WHERE status = 'processing'
  AND updated_at < NOW() - INTERVAL '8 minutes'
```

Y para cada uno:
```sql
UPDATE proyectos
SET status = 'error',
    error_message = 'Pipeline detectado como colgado por el watchdog (>8min sin actividad).'
WHERE id = $1
```

Sin esto, un proyecto puede quedar en "Processing" durante 30+ min
hasta que el sandbox timeout vence. El usuario ve el error rápido y
puede reintentar.

### `scripts/run-next.js`

Wrapper de `next dev` con `windowsHide: true` para que la ventana del
servidor no aparezca en cada restart. PM2 spawnea este wrapper en lugar
de `next` directo.

---

## 17. Decisiones no negociables

Documentadas en [`AGENTS.md`](../AGENTS.md). Cada una vino de un
incidente real:

### 1. Claude genera JSON de configuración, NUNCA código TSX en runtime
**Por qué**: si Claude generara el TSX, cada render dependería de
eval-ing código del LLM. Riesgos: code injection si un usuario malicioso
envía un brief con código, errores de sintaxis del LLM que rompen el
render, imposible de testear.

**Solución**: Claude devuelve JSON parseable (`{ snippets, enfasisPalabras, animacionOverride }`). El TSX está en `remotion/compositions/` versionado
en git. Claude parametriza, no programa.

### 2. FFmpeg corre dentro de Vercel Sandbox, NUNCA en API routes
**Por qué**: una API route tiene 300s max, 4GB RAM hard, sin disco
persistente. ffmpeg con 20 clips × 60MB requiere mucho más.

**Solución**: API route encola el evento, Sandbox hace el trabajo.

### 3. El pipeline corre en Inngest, NO con fire-and-forget
**Por qué**: si la function HTTP request termina mientras el pipeline
sigue, todo el estado se pierde. Si crashea, no hay retry automático.
**Solución**: cada I/O en su propio `step.run()`. Inngest persiste,
reintenta, observa.

### 4. Webhooks ClickUp validan firma HMAC siempre
**Por qué**: el endpoint `/api/webhooks/clickup` recibe eventos
externos. Sin validación HMAC, cualquier IP de Internet puede crear
proyectos contra nuestra app sin pasar por auth.

**Solución**: [`lib/hmac.ts`](../lib/hmac.ts) valida la firma
`X-Signature` con `CLICKUP_WEBHOOK_SECRET`. 401 si no matchea.

### 5. Rate limiting + Vercel Spend Management activos desde el día 1
**Por qué**: un atacante que descubra el endpoint POST `/api/pipeline`
puede encolar 1000 pipelines en un minuto → cuenta Anthropic + OpenAI +
Sandbox factura miles de dólares.

**Solución**: Upstash Ratelimit por IP (cuando configurado), Spend
Management de Vercel con tope mensual configurado en el dashboard.

### 6. Sandboxes: SIEMPRE `shutdown()` en `finally`
**Por qué**: si el step crashea o lanza una excepción, el sandbox
queda vivo hasta el timeout (30min). Consume créditos sin hacer nada.

**Solución**:
```ts
const sandbox = await createPreprocessSandbox();
try { /* ... */ } finally { await sandbox.stop(); }
```
SIEMPRE. Sin excepción.

---

## 18. Performance — los números reales

### Tiempos típicos por step (16 clips × ~60 MB, 90s output final)

| Step | Tiempo | Bottleneck principal |
|---|---|---|
| preflight | 2-3s | HEAD requests |
| analyze-clips | 2-3 min | Descargas paralelas + ffmpeg metadata + ffmpeg audio extract |
| transcribe-clips | 1-2 min | Whisper API (conc 3) |
| claude-multiclip | 30-60s | Claude Sonnet 4.5 round-trip |
| ffmpeg-multiclip-concat | 1-2 min | Descargas paralelas + ffmpeg two-pass |
| adjust-transcripcion | <1s | Solo CPU |
| generate-exports | 30s (sin embed) / 5-15 min (con embed) | Descargas paralelas de clips si embed |
| final-render (opcional) | 5-15 min | Remotion render (90% del tiempo) |
| **TOTAL sin Remotion + sin embed** | **5-7 min** | |
| **TOTAL con Remotion + sin embed** | **10-12 min** | |

### Las 4 optimizaciones aplicadas (vs versión 1)

1. **Whisper paralelo conc 3** (era secuencial): step 2 de 3-5 min a 1-2 min.

2. **Descargas paralelas en sandbox con xargs -P 4** (era secuencial):
   steps 1 y 4 de 4-8 min cada uno a 1-2 min cada uno.

3. **ZIP CapCut liviano por default** (antes embebía 922 MB): step 6
   de 5-15 min a 30s.

4. **Selección por índice de palabra** (antes timestamps inventados):
   no mejora tiempo pero elimina la mayoría de cortes a mitad de palabra
   → menos iteraciones manuales del editor → menos re-renders.

**Mejora end-to-end**: para un proyecto de 16 clips, pasamos de
**~25-50 min** (versión 1, antes de optimizaciones) a **~5-12 min**
(versión actual). **~70% más rápido**.

### El bottleneck que queda: descargar los clips 3 veces

Actualmente:
- Step 1 (analyze-clips): descarga al sandbox A
- Step 4 (ffmpeg-concat): descarga al sandbox B (sandbox A ya cerró)
- Step 6 con embed: descarga a Node (no a sandbox)

Eso son **3× la transferencia total** de clips desde Blob. Para 922 MB,
es ~2.7 GB de IO.

**Roadmap**: compartir un sandbox vivo entre steps 1 y 4 (mantenerlo
abierto). Esto bajaría el pipeline de 5-7 min a ~3-5 min.

---

## 19. Trade-offs y limitaciones conocidas

### Limitaciones técnicas hardcoded

| Limitación | Valor actual | Por qué |
|---|---|---|
| Máximo clips por proyecto multiclip | 20 | El prompt de Claude se vuelve unwieldy con más + sandbox storage limit |
| Máximo silencios en prompt de Claude | 200 | Para no saturar el context window con metadata |
| Máximo palabras por clip en prompt | 3000 | Cubre ~15 min de habla. Más se trunca |
| Duración mínima de snippet | 1.0s | Menos suena entrecortado |
| Padding START_PAD / END_PAD | 0.08s / 0.18s | Empírico — más corta consonantes finales |
| Silencio interno máximo permitido en snippet | 0.8s | Se parte automáticamente si excede |
| Concurrencia Whisper | 3 | Lejos del rate limit de 50/min de OpenAI |
| Concurrencia descargas en sandbox | 4 | Balance entre velocidad y memoria del sandbox |
| Sandbox timeout | 30min | Cubre worst-case render Remotion |
| Inngest retries por función | 2 | 3 intentos totales (original + 2 retries) |

### Limitaciones del modelo (Claude)

- **Solo español**: el prompt está optimizado para español rioplatense
  + neutral. Para otros idiomas el listado de muletillas no aplica.
  Whisper también está hardcoded a `language: "es"`.
- **Calidad variable según el material**: clips con muchas pausas
  cortas o solapamiento de voces confunden a Claude. Resultado:
  snippets más cortos y más numerosos.
- **No detecta sarcasmo / contexto cultural**: si el cliente dice
  "ay, qué éxito" sarcásticamente, Claude lo puede tomar literal y
  enfatizar "éxito" como si fuera positivo.

### Limitaciones del render Remotion

- **Solo 3 aspect ratios**: 9:16, 1:1, 16:9. Para 4:5 (Instagram feed)
  habría que agregar.
- **Render lento**: 5-15 min para 60-90s de output. Es la principal
  fuente de espera del usuario.
- **5 animaciones de subs**: si el cliente quiere algo custom (ej.
  glitch, neon glow), hay que codearlo en `SubtitulosDinamicos.tsx`.

### Limitaciones del editor visual

- **Solo multiclip**: proyectos `original`/`mirage`/`cortes` no son
  editables. Tendrían que adaptarse el flujo de datos.
- **Re-derivar transcripción pierde edits**: si el usuario reordenó
  snippets, el botón "Re-sincronizar subs" pierde las edits manuales
  de texto. No hay forma de mantener AMBOS (snippets nuevos + texto
  editado) sin un mapeo más complejo.
- **Sin colaboración en tiempo real**: dos usuarios editando el mismo
  proyecto al mismo tiempo pisan sus cambios (último PATCH gana).

---

## 20. Roadmap

### Corto plazo (1-2 sprints)

- [ ] **Compartir sandbox entre steps 1 y 4** — descargar clips una
      sola vez. Estimado: pipeline 5-7min → 3-5min.
- [ ] **Detectar formato uniforme en clips** — si todos son 1080×1920
      30fps h264, el `concat` puede ser sin re-encode (de 1-2min a 10s).
- [ ] **Endpoint replan ya implementado** ✅ — re-ejecuta Claude sin
      re-procesar clips. Útil para iterar prompts.
- [ ] **UI del módulo Montaje automático** con preview.

### Medio plazo (3-6 sprints)

- [ ] **Endpoint público sin login** con webhook de respuesta — para
      integrar con ClickUp/Zapier/n8n.
- [ ] **Few-shot examples en el prompt de Claude** — cargar 5-10
      ejemplos reales de planes buenos para que Claude calibre.
- [ ] **Detección semántica de redundancia post-Claude** — pasar los
      snippets a Claude en un segundo pase y preguntarle "hay
      repeticiones que no captaste?". Costo extra de un API call pero
      mejora calidad mucho.
- [ ] **Mapeo de transcripción entre revisiones** para no perder edits
      al re-derivar.

### Largo plazo

- [ ] **Multi-tenant real** — workspaces con varios users por
      organización, roles (admin/editor/viewer), facturación.
- [ ] **Colaboración en tiempo real** en el editor (CRDT o lock por sección).
- [ ] **Modelos de IA on-premise** (Whisper local en GPU, Llama
      fine-tuned) para clientes que requieren no salir de su red.
- [ ] **Pipeline visual** — el cliente puede definir su propio pipeline
      con nodos (transcribir → traducir → resumir → cortar → exportar) en
      lugar de los 7 fijos.

---

## Apéndice A — Mapa del código

```
App-Editing-AI/
├── app/
│   ├── (auth)/                          # login + signup
│   ├── (dashboard)/dashboard/           # UI principal
│   │   ├── clientes/                    # CRUD perfiles cliente
│   │   ├── cortar/                      # módulo cortar-silencios-a-XML
│   │   ├── montaje/                     # módulo Montaje automático
│   │   └── proyectos/[id]/editor/       # editor visual multiclip
│   ├── api/
│   │   ├── auth/                        # NextAuth endpoints
│   │   ├── clientes/                    # CRUD clientes
│   │   ├── cortar/                      # CRUD módulo cortar
│   │   ├── inngest/                     # webhook Inngest
│   │   ├── migrate/                     # schema migrations
│   │   ├── mirage/templates/            # listar templates Captions.ai
│   │   ├── pipeline/
│   │   │   ├── route.ts                 # POST encolar
│   │   │   └── [projectId]/
│   │   │       ├── status/              # GET polling
│   │   │       ├── download/            # proxy descarga
│   │   │       ├── cancel/              # cancelar pipeline
│   │   │       ├── retry/               # reintentar
│   │   │       ├── duplicate/           # duplicar proyecto
│   │   │       ├── editor/              # GET/PATCH del editor
│   │   │       ├── regenerate-capcut/   # solo regen ZIP CapCut
│   │   │       ├── regenerate-editables/# regen XML/EDL/CapCut/SRT
│   │   │       ├── rerender-output/     # rerender MP4 + exports
│   │   │       ├── replan/              # re-ejecutar Claude
│   │   │       └── resync-transcripcion/# re-derivar subs
│   │   ├── upload/                      # Vercel Blob client upload bypass
│   │   ├── upload-guion/                # parser de .txt/.docx/.pdf
│   │   └── webhooks/clickup/            # webhook con HMAC
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── clientes/                        # ClienteForm
│   ├── dashboard/                       # Header, Sidebar, MetricsCard
│   ├── proyectos/
│   │   ├── MultiUploadZone.tsx          # drag-drop múltiple
│   │   ├── PipelineStatus.tsx           # progreso en vivo
│   │   ├── RenderMethodChip.tsx         # badge del modo
│   │   ├── SubtitulosOverrideForm.tsx   # form de override
│   │   ├── UploadZone.tsx               # drag-drop simple
│   │   ├── VideoPreview.tsx             # preview output
│   │   ├── RemotionPlayerInner.tsx      # wrapper Player
│   │   └── editor/                      # 11 componentes del editor
│   └── ui/                              # Badge, Button, Card, Input, Logo
├── hooks/
│   └── useEditorHistory.ts              # undo/redo con debounce
├── inngest/
│   ├── client.ts                        # cliente Inngest singleton
│   └── functions/
│       ├── pipeline.ts                  # original / mirage
│       ├── cortar-silencios.ts          # módulo cortar
│       ├── proyecto-cortes.ts           # cortes con IA + exports
│       ├── proyecto-multiclip.ts        # multiclip + rerender + replan
│       └── montaje.ts                   # módulo montaje automático
├── lib/
│   ├── anthropic.ts                     # cliente Claude + prompt simple
│   ├── anthropic-cortes.ts              # planning de cortes
│   ├── anthropic-multiclip.ts           # planning multiclip + heurísticas
│   ├── api-auth.ts                      # requireAuth() helper
│   ├── blob.ts                          # wrapper Vercel Blob + publicBlobUrl
│   ├── capcut-draft.ts                  # generador CapCut single-clip
│   ├── clientes.ts                      # CRUD clientes
│   ├── clips-bundle.ts                  # README + scripts descarga
│   ├── cortes-db.ts                     # CRUD módulo cortes
│   ├── cuts-utils.ts                    # ajuste de transcripción tras cortes
│   ├── davinci-edl.ts                   # generador EDL
│   ├── db.ts                            # CRUD proyectos + clientes
│   ├── ffmpeg.ts                        # detección silencios + comandos
│   ├── ffmpeg-local.ts                  # ffmpeg-static para módulo Montaje
│   ├── hmac.ts                          # validación HMAC ClickUp
│   ├── mirage.ts                        # cliente Captions.ai
│   ├── montajes-db.ts                   # CRUD módulo montajes
│   ├── multiclip-exports.ts             # generadores XML/EDL/CapCut multiclip
│   ├── multiclip-utils.ts               # ffmpeg concat + unión transcripción
│   ├── openai.ts                        # cliente Whisper
│   ├── pipeline-cancel.ts               # helper para cancelar pipeline
│   ├── pipeline-progress.ts             # advanceToStep + startHeartbeat
│   ├── preflight.ts                     # validación pre-pipeline
│   ├── premiere-xml.ts                  # generador XML single-clip
│   ├── ratelimit.ts                     # Upstash Ratelimit opcional
│   ├── render.ts                        # renderizar con Remotion en Sandbox
│   ├── sandbox.ts                       # wrappers @vercel/sandbox
│   ├── srt.ts                           # generador SRT
│   └── utils.ts                         # helpers misc
├── migrations/                          # SQL histórico (.sql files)
├── remotion/
│   ├── Root.tsx                         # registro Composition
│   ├── index.ts                         # entry para bundler
│   └── compositions/
│       ├── VideoBase.tsx                # render server (video_unido)
│       ├── MulticlipComposition.tsx     # preview live + render multiclip
│       └── SubtitulosDinamicos.tsx      # subs animados (5 animaciones)
├── scripts/
│   ├── debug-project.mjs                # CLI: inspect proyecto
│   ├── cancel-project.mjs               # CLI: cancelar pipeline
│   ├── retry-project.mjs                # CLI: reintentar pipeline
│   ├── replan-project.mjs               # CLI: re-ejecutar Claude
│   ├── migrate.ts                       # CLI: correr migrations contra Vercel
│   ├── oidc-cron.js                     # PM2: refresh OIDC cada 6h
│   ├── refresh-oidc.ps1                 # script de refresh real
│   ├── pm2-watchdog.ps1                 # watchdog general (legacy)
│   ├── stuck-pipeline-cron.js           # PM2: kill stuck pipelines
│   ├── run-next.js                      # wrapper Next con windowsHide
│   └── run-ps1-hidden.vbs               # wrapper VBS para .ps1 sin ventana
├── types/
│   ├── index.ts                         # tipos compartidos
│   └── next-auth.d.ts                   # extiende Session.user.id
├── data/
│   └── clientes/cliente-demo.json       # cliente demo (no se usa en prod)
├── build/                               # bundle Remotion (committed)
├── AGENTS.md                            # reglas no negociables
├── ARCHITECTURE.md                      # (este archivo, en docs/)
├── MIGRATION.md                         # guía de migrations
├── README.md                            # vista rápida
├── auth.config.ts                       # NextAuth config (Edge compat)
├── auth.ts                              # NextAuth full config
├── middleware.ts                        # auth middleware (cookies)
├── next.config.ts
├── package.json
├── tsconfig.json
├── ecosystem.config.js                  # PM2 manifest (dev local)
└── vercel.json                          # config deploy + maxDuration
```

---

## Apéndice B — Glosario

- **Clip**: archivo de video crudo subido por el cliente. Una toma sola.
- **Snippet**: tramo de un clip seleccionado por Claude para incluir en el video final.
- **Plan multiclip**: objeto JSONB con `{ snippets, enfasisPalabras, animacionOverride, observaciones }` que Claude devuelve.
- **video_unido**: el MP4 resultado del concat ffmpeg de los snippets. Está en `intermedio-multiclip/{id}.mp4`. NO tiene subs quemados.
- **outputUrl**: el MP4 final. Si renderSubtitulos=true, es el video con subs quemados (`outputs/{id}.mp4`). Si false, apunta al video_unido.
- **Transcripción per-clip**: `WordTimestamp[][]` — un array por cada clip con sus palabras y timestamps.
- **Transcripción ajustada (o "final")**: `WordTimestamp[]` — palabras del video final con timestamps en la timeline final (después del concat).
- **Snap to words**: ajustar un timestamp dado por Claude al boundary de una palabra real de Whisper.
- **Editor visual**: la UI en `/dashboard/proyectos/[id]/editor` con timeline + paneles.
- **Re-render**: re-ejecutar concat ffmpeg + render Remotion con el plan editado.
- **Re-plan**: re-ejecutar Claude con las transcripciones persistidas y un prompt actualizado.

---

🤖 Documento mantenido junto al código. Última actualización: ver
`git log -1 --format='%cd' docs/ARCHITECTURE.md`.
