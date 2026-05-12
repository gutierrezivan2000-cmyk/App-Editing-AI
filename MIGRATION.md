# Guía de Migraciones

## ¿Por qué necesitamos migraciones?

Las migraciones crean y mantienen las tablas de la base de datos. En este proyecto, usamos el endpoint `/api/migrate` que ejecuta SQL basado en un `AUTH_SECRET` (para evitar acceso público).

## Estado actual

### Migraciones pendientes:
- **0002**: Agrega columna `render_method` a la tabla `proyectos`
- **0003**: Crea la tabla `cortes` para el módulo de silencio-a-XML

## Cómo ejecutar las migraciones

### Opción 1: Script TypeScript (recomendado)

```bash
npx ts-node scripts/migrate.ts \
  https://tu-app.vercel.app \
  tu-auth-secret
```

O con variables de entorno:

```bash
export MIGRATION_URL=https://tu-app.vercel.app
export AUTH_SECRET=tu-auth-secret
npx ts-node scripts/migrate.ts
```

### Opción 2: curl desde terminal

```bash
curl -X POST https://tu-app.vercel.app/api/migrate \
  -H "x-admin-secret: TU_AUTH_SECRET"
```

### Opción 3: Desde el navegador (DevTools Console)

En cualquier página de tu app, abre la consola (F12) y ejecuta:

```javascript
fetch('https://tu-app.vercel.app/api/migrate', {
  method: 'POST',
  headers: { 'x-admin-secret': 'TU_AUTH_SECRET' }
}).then(r => r.json()).then(console.log);
```

## Cómo obtener AUTH_SECRET

1. Ve a tu proyecto en **Vercel** → **Settings** → **Environment Variables**
2. Busca la variable `AUTH_SECRET` (cópiala exactamente, sin espacios)
3. Usa ese valor en los comandos anteriores

## Respuesta esperada

Si todo funciona, recibirás:

```json
{
  "ok": true,
  "applied": ["0002_render_method", "0003_cortes"]
}
```

O si ya se ejecutó antes:

```json
{
  "ok": true,
  "applied": []
}
```

(Las migraciones son idempotentes — si la tabla ya existe, `CREATE TABLE IF NOT EXISTS` la ignora)

## Verificación

Después de ejecutar la migración, la tabla `cortes` estará lista:

```sql
SELECT * FROM cortes;
```

Y podrás usar la funcionalidad en **Dashboard** → **Cortar silencios**.

## Troubleshooting

### Error: "Unauthorized" (401)

- ✓ Verifica que `AUTH_SECRET` sea exacto
- ✓ Asegúrate de copiar todo el valor (sin espacios extra)
- ✓ Usa la versión actual desde Vercel, no una versión anterior

### Error: "Cannot find module 'ts-node'"

Instala ts-node como devDependency:

```bash
npm install --save-dev ts-node
```

### Error de conexión a base de datos

- ✓ La base de datos Postgres debe estar disponible en Vercel
- ✓ Verifica que `DATABASE_URL` esté configurada en Vercel
- ✓ Espera unos segundos si acabas de crear la base de datos

## Notas técnicas

- Las migraciones se definen en `/app/api/migrate/route.ts`
- Usan `@vercel/postgres` para ejecutar SQL
- Cada migración está protegida por `x-admin-secret` header
- Las migraciones son ejecutadas una sola vez (idempotentes con `IF NOT EXISTS`)
