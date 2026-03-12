# Collaborative Editor

Editor colaborativo en tiempo real con:
- Next.js + React + TypeScript
- TipTap
- Yjs (CRDT)
- WebSocket server propio

## Estado actual

- Edición colaborativa en tiempo real.
- Presencia de usuarios + typing indicators.
- Historial de cambios en UI.
- Compartir documento por URL.
- Persistencia de snapshots en el servidor realtime (archivo en disco).
- Biblioteca privada de documentos desde UI (listar, abrir y borrar IDs conocidos por navegador).

## Requisitos

- Node.js 22+
- pnpm 10+

## Instalación

```bash
pnpm install
```

## Variables de entorno

Copiar `.env.example` y ajustar según tu entorno.

Variables principales:
- `NEXT_PUBLIC_WS_URL`: URL del websocket realtime para el frontend.
- `NEXT_PUBLIC_WS_HTTP_URL`: URL HTTP para endpoints de biblioteca (`/documents`).
- `HOST`: host de bind del server realtime.
- `WS_PORT`: puerto del server realtime.
- `WS_CORS_ORIGIN`: origen permitido para CORS en endpoints HTTP del server realtime.
- `WS_PERSISTENCE_DIR`: carpeta de snapshots de documentos.
- `WS_SAVE_DEBOUNCE_MS`: debounce de guardado de snapshots.
- `WS_MAX_CONNECTIONS`: límite global de conexiones websocket.
- `WS_MAX_CONNECTIONS_PER_DOC`: límite de conexiones websocket por documento.
- `WS_MAX_ACTIVE_DOCS`: límite de documentos activos simultáneamente en memoria.
- `WS_MAX_DOCS_PER_OWNER`: límite de documentos creados por usuario.
- `WS_MAX_MESSAGE_BYTES`: tamaño máximo de mensaje websocket.
- `WS_DOC_IDLE_TTL_MS`: tiempo de inactividad para evicción de docs sin conexiones.
- `WS_DOC_EVICT_INTERVAL_MS`: intervalo del barrido de evicción por inactividad.
- `WS_MEMORY_SOFT_LIMIT_MB`: umbral de memoria (RSS) para rechazar nuevas conexiones.

## Desarrollo local

En dos terminales:

1. Server realtime:
```bash
pnpm dev:ws
```

2. Frontend:
```bash
pnpm dev
```

Abrir:
- `http://localhost:3000`
- `http://localhost:3000/doc/demo-doc-001` en dos pestañas para validar sync.

## Scripts

- `pnpm dev`: Next.js dev server
- `pnpm dev:ws`: websocket server (desarrollo)
- `pnpm build`: build frontend
- `pnpm start`: levantar frontend build
- `pnpm start:ws`: websocket server (runtime)
- `pnpm lint`: linting

## Persistencia de documentos

El websocket server guarda snapshots por `docId` en:

`WS_PERSISTENCE_DIR/<docId>.bin`

Comportamiento:
- carga snapshot al primer acceso del documento,
- guarda en cada cambio con debounce,
- flush final al cerrar proceso (`SIGINT`/`SIGTERM`).

## API HTTP del realtime server

El mismo server realtime expone endpoints de gestión:

- `GET /documents`: lista documentos persistidos/activos.
- `GET /documents/:id`: consulta existencia/metadata de un documento.
- `POST /documents`: crea documento explícitamente (requiere `id` válido).
- `DELETE /documents/:id`: elimina snapshot y sesión activa del documento.
  - Solo permitido para el creador del documento (`x-user-id`).

## Lifecycle de documentos

- Los documentos se crean explícitamente desde `GET /doc/new` (que invoca `POST /documents`).
- `POST /documents` requiere header `x-user-id` para registrar creador y aplicar cuota por usuario.
- Abrir `/doc/:id` valida existencia en el server realtime.
- Si un documento fue borrado, no puede “recrearse” solo por abrir la URL.
- La home muestra solo documentos conocidos por ese navegador (creados o abiertos por link).

## Deploy

### Frontend (Vercel)

1. Conectar repo en Vercel.
2. Configurar `NEXT_PUBLIC_WS_URL` apuntando al backend realtime productivo.
3. Deploy.

### Realtime server (Railway/Fly/Docker)

Se incluye `server/Dockerfile` para deploy containerizado.

Ejemplo build/run local:
```bash
docker build -f server/Dockerfile -t collaborative-editor-ws .
docker run -p 1234:1234 -v ${PWD}/server/.data:/data collaborative-editor-ws
```

Variables recomendadas en producción:
- `HOST=0.0.0.0`
- `WS_PORT=1234` (o puerto asignado por plataforma)
- `WS_PERSISTENCE_DIR=/data/documents`
- `WS_SAVE_DEBOUNCE_MS=700`
- `WS_MAX_CONNECTIONS=400`
- `WS_MAX_CONNECTIONS_PER_DOC=32`
- `WS_MAX_ACTIVE_DOCS=200`
- `WS_MAX_DOCS_PER_OWNER=12`
- `WS_MAX_MESSAGE_BYTES=1048576`
- `WS_DOC_IDLE_TTL_MS=300000`
- `WS_DOC_EVICT_INTERVAL_MS=30000`
- `WS_MEMORY_SOFT_LIMIT_MB=768`

Runbook completo de deploy y smoke test:
- `Docs/DEPLOY_RUNBOOK.md`
