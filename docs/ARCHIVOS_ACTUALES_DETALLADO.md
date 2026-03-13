# Documentación técnica completa del código

Este documento explica **todo el código fuente actual** del repositorio `RealtimeEditor`: qué hace cada archivo, por qué existe, qué problema resuelve y qué conceptos técnicos engloba.

> Alcance: frontend (Next.js), backend realtime (WebSocket + Yjs), hooks, utilidades, tipos, estilos e infraestructura.

---

## 1) Visión global de arquitectura

El proyecto implementa un editor colaborativo en tiempo real con tres capas:

1. **UI y rutas (Next.js App Router)**
   - Renderiza páginas, formularios, editor TipTap, presencia de usuarios e historial local.
2. **Sincronización colaborativa (Yjs + y-websocket protocol)**
   - El estado del documento se modela como CRDT usando `Y.Doc`.
   - La sincronización entre clientes ocurre por WebSocket usando mensajes binarios del protocolo de Yjs.
3. **Servidor realtime propio (Node + ws)**
   - Acepta conexiones por documento.
   - Gestiona awareness (presencia/typing), límites operativos, persistencia en disco y API HTTP de documentos.

### Términos clave (explicados)

- **CRDT (Conflict-free Replicated Data Type)**: estructura de datos distribuida que permite ediciones concurrentes sin conflictos manuales. Se usa para que varios usuarios editen el mismo documento sin “pisarse”.
- **Yjs**: implementación de CRDT en JavaScript. Aquí mantiene el estado del documento y sincroniza cambios.
- **Awareness**: canal de metadatos efímeros (usuario, color, typing, cursor) que no forman parte del contenido del documento.
- **WebSocket**: conexión bidireccional persistente cliente-servidor, ideal para colaboración en tiempo real.
- **TipTap**: editor de texto rico sobre ProseMirror. Se integra con Yjs para colaboración.
- **App Router**: sistema de rutas de Next.js basado en carpeta `app/`.

---

## 2) Estructura por carpetas

- `app/`: páginas y rutas de Next.js.
- `components/`: componentes de interfaz reutilizables.
- `hooks/`: lógica reactiva de colaboración, presencia e historial.
- `lib/`: utilidades de dominio (documentos, presencia, storage, websocket, yjs).
- `server/`: servidor WebSocket/HTTP y persistencia en disco.
- `types/`: tipos TypeScript de documento y usuario.
- raíz (`Dockerfile.ws`, configs): infraestructura y tooling.

---

## 3) Frontend (Next.js)

## `app/layout.tsx`

**Qué es**
- Layout raíz de la aplicación.

**Por qué se usa**
- Define metadatos globales, carga fuentes (`Geist`, `Geist_Mono`) y aplica tema antes de hidratar React para evitar parpadeos visuales.

**Detalles importantes**
- Inserta un script inline que lee `localStorage` y `prefers-color-scheme` para fijar `data-theme` en `<html>`.
- Usa `suppressHydrationWarning` porque el tema puede establecerse antes de la hidratación.

## `app/page.tsx`

**Qué es**
- Home de la app: biblioteca privada (por navegador), creación/apertura/borrado de documentos y edición del nombre del colaborador.

**Por qué se usa**
- Centraliza el “workspace” donde el usuario gestiona documentos conocidos localmente.

**Lógica relevante**
- `loadDocuments`: toma IDs guardados en `localStorage`, consulta `/documents/:id` y limpia IDs huérfanos.
- `handleCreateDocument`: crea documento con reintentos (colisión de ID `409`) y maneja cuota (`429`).
- `handleDeleteDocument`: borra remoto + remueve de biblioteca local.
- `handleSaveCollaboratorName`: persiste nombre de usuario en `sessionStorage`.
- Incluye refresco periódico y por `visibilitychange`.

## `app/doc/[id]/page.tsx`

**Qué es**
- Página del editor colaborativo para un documento concreto.

**Por qué se usa**
- Valida ID y existencia del documento antes de renderizar el editor (si falla: `notFound()`).

## `app/doc/[id]/history/page.tsx`

**Qué es**
- Página de historial completo del documento.

**Por qué se usa**
- Separa la vista de historial extendido del editor principal para una navegación limpia.

## `app/doc/new/route.ts`

**Qué es**
- Route Handler que crea un documento y redirige a `/doc/:id`.

**Por qué se usa**
- Permite flujos de creación vía URL backend-safe (con owner obligatorio y validado).

**Detalles**
- Reintenta hasta `MAX_CREATE_ATTEMPTS` para evitar colisiones de IDs.
- Propaga error de cuota (`429`) y retorna `503` si no logra crear.

## `app/globals.css`

**Qué es**
- Estilos globales y tokens visuales.

**Por qué se usa**
- Define sistema de color para tema claro/oscuro, clases utilitarias de diseño (`surface-card`, `btn`, `status-pill`), ajustes de tipografía y estilos de cursores colaborativos.

---

## 4) Componentes UI

## `components/Editor.tsx`

**Qué es**
- Componente principal de edición colaborativa.

**Por qué se usa**
- Orquesta TipTap + Yjs + awareness + historial + presencia.

**Cómo funciona**
- Obtiene recursos de colaboración (`useCollaborativeDocument`).
- Convierte awareness en lista de usuarios (`useUserPresence`).
- Registra eventos de cambio (`useDocumentHistory`).
- Configura extensiones TipTap:
  - `StarterKit` (sin undo/redo local para no romper modelo colaborativo).
  - `Collaboration` (sincroniza contenido CRDT).
  - `CollaborationCaret` (cursores remotos).
- Marca `isTyping` en awareness al detectar transacciones locales reales.

## `components/Toolbar.tsx`

**Qué es**
- Barra de formato del editor.

**Por qué se usa**
- Encapsula acciones de edición (negrita, cursiva, headings, listas) en botones simples reutilizables.

## `components/UserPresence.tsx`

**Qué es**
- Panel lateral de usuarios conectados.

**Por qué se usa**
- Da visibilidad del estado colaborativo y del propio usuario.

## `components/UserCursor.tsx`

**Qué es**
- “Chip” visual de usuario con iniciales, color, estado actual y typing.

**Por qué se usa**
- Normaliza la representación de identidad en la UI.

## `components/ChangeHistory.tsx`

**Qué es**
- Vista resumida del historial (preview lateral).

**Por qué se usa**
- Permite inspección rápida de actividad sin salir del editor.

## `components/DocumentHistoryView.tsx`

**Qué es**
- Vista completa de historial.

**Por qué se usa**
- Separa el caso de uso “auditar cambios” de la edición principal.

## `components/DocumentHeader.tsx`

**Qué es**
- Cabecera del documento con ID, navegación y botón “copiar link”.

**Por qué se usa**
- Estandariza acciones primarias del documento y recuerda el ID en biblioteca local.

## `components/ThemeToggle.tsx`

**Qué es**
- Interruptor claro/oscuro.

**Por qué se usa**
- Mantiene consistencia entre tabs mediante `storage` + evento custom.

---

## 5) Hooks

## `hooks/useCollaborativeDocument.ts`

**Qué es**
- Hook de inicialización/conexión colaborativa (Y.Doc + WebsocketProvider + awareness).

**Por qué se usa**
- Evita duplicar la lógica compleja de ciclo de vida WebSocket y sincronización.

**Responsabilidades**
- Crea recursos colaborativos memoizados por `documentId`.
- Define usuario local en awareness (`user`, `isTyping`).
- Reintenta verificar existencia del documento antes de conectar.
- Exposición de estado de conexión (`connecting/connected/disconnected`), sync y errores.
- Cleanup robusto (disconnect + destroy diferido).

## `hooks/useUserPresence.ts`

**Qué es**
- Hook que transforma estados de awareness en `UserModel[]` reactivo.

**Por qué se usa**
- Encapsula suscripción/normalización/ordenamiento de usuarios.

**Punto técnico**
- Usa `useSyncExternalStore`, patrón recomendado para sincronizar React con stores externos/event-driven.

## `hooks/useDocumentHistory.ts`

**Qué es**
- Hook de tracking de cambios del documento.

**Por qué se usa**
- Genera eventos de historial local legibles para UI.

**Comportamiento**
- Escucha `document.on("update")`.
- Detecta actor local vs remoto.
- Fusiona eventos consecutivos del mismo usuario en una ventana de tiempo (`MERGE_WINDOW_MS`) para evitar ruido.
- Persiste historial en `sessionStorage`.

---

## 6) Librerías internas (`lib/`)

## `lib/document.ts`

**Qué es**
- Utilidades de ID/ruta de documentos.

**Por qué se usa**
- Centraliza reglas de validez (`regex`) y generación de IDs.

## `lib/library.ts`

**Qué es**
- Biblioteca local de documentos conocidos en `localStorage`.

**Por qué se usa**
- El backend no implementa “listado por usuario autenticado real”; esta capa da una biblioteca privada por navegador.

## `lib/presence.ts`

**Qué es**
- Gestión de identidad del colaborador y validaciones.

**Por qué se usa**
- Asegura que cada pestaña tenga un usuario consistente (`sessionStorage`) con color estable.

**Concepto relacionado**
- **Identidad efímera por sesión**: no hay auth completa; la identidad vive en sesión del navegador.

## `lib/document-history.ts`

**Qué es**
- Lectura/escritura del historial de cambios en `sessionStorage`.

**Por qué se usa**
- Hace persistencia local liviana y aislada por documento.

## `lib/websocket.ts`

**Qué es**
- Resolución de URLs WS/HTTP del backend realtime.

**Por qué se usa**
- Evita hardcode y simplifica soporte local + producción vía env vars.

## `lib/yjs.ts`

**Qué es**
- Helpers mínimos de Yjs (`createYDoc`, `getXmlFragment`).

**Por qué se usa**
- Reduce acoplamiento y deja un punto único para extender configuración CRDT.

## `lib/editor.ts`

**Qué es**
- Contenido inicial estático legado.

**Por qué se usa**
- Actualmente sirve como referencia del estado previo/local del editor.

---

## 7) Tipos (`types/`)

## `types/document.ts`

- `DocumentModel`: metadatos de documento.
- `DocumentDirectoryItem`: shape que usa la biblioteca UI (`status`, `sizeBytes`, `canDelete`).
- `DocumentChangeEvent`: evento de historial (actor, timestamp, tipo, resumen).

## `types/user.ts`

- `CollaboratorIdentity`: identidad mínima compartida por awareness.
- `UserModel`: identidad + estado de presencia para renderizado.

---

## 8) Backend realtime (`server/`)

## `server/persistence.ts`

**Qué es**
- Capa de persistencia de snapshots Yjs a disco (`.bin`) + metadata (`.meta.json`).

**Por qué se usa**
- Permite que los documentos sobrevivan reinicios del servidor.

**Funciones clave**
- `loadDocumentSnapshot`: hidrata `Y.Doc` desde disco.
- `scheduleDocumentSave`: debounce de guardado para no escribir en cada keystroke.
- `flushDocumentSave` / `flushAllDocuments`: forzado de persistencia.
- `create/get/list/delete` de documentos persistidos.
- owner metadata para cuotas por creador.

## `server/websocket-server.ts`

**Qué es**
- Servidor principal HTTP + WebSocket.

**Por qué se usa**
- Implementa colaboración realtime completa y API de gestión documental.

**Módulos lógicos internos**
1. **Configuración/límites**
   - Máximos de conexiones, docs activos, tamaño de mensaje, memoria soft limit, TTL de docs ociosos, cuota por owner.
2. **Modelo `SharedDoc`**
   - Extiende `Y.Doc` con conexiones (`conns`), awareness y `lastActivityAt`.
3. **Transporte Yjs**
   - Procesa mensajes binarios: `MESSAGE_SYNC`, `MESSAGE_AWARENESS`, `MESSAGE_QUERY_AWARENESS`.
4. **Gestión de conexiones**
   - Ping/pong, cierre seguro, control de over-capacity, limpieza de awareness al desconectar.
5. **Evicción de documentos ociosos**
   - Libera memoria destruyendo docs sin conexiones tras TTL.
6. **API HTTP**
   - `GET /documents` lista documentos.
   - `POST /documents` crea documento (con owner y cuota).
   - `GET /documents/:id` consulta documento.
   - `DELETE /documents/:id` elimina sesión activa + snapshot.
   - `GET /health` métricas y límites.
7. **Upgrade WebSocket**
   - Valida ID, existencia, límites y luego conecta usando `wss.handleUpgrade`.
8. **Apagado seguro**
   - `SIGINT/SIGTERM` hacen flush de snapshots antes de salir.

---

## 9) Configuración e infraestructura

## `package.json`

- Define scripts (`dev`, `dev:ws`, `start:ws`, `lint`, etc.) y dependencias principales (Next, React, TipTap, Yjs, ws).

## `Dockerfile.ws` y `server/Dockerfile`

- Imágenes para ejecutar servidor realtime con Node 22 Alpine.
- Exponen puerto `1234`, fijan env defaults y ruta de persistencia en `/data/documents`.

## `tsconfig.json`

- Configuración TypeScript strict + alias `@/*`.

## `eslint.config.mjs`

- Reglas Next core-web-vitals + TypeScript.

## `postcss.config.mjs`

- Plugin de Tailwind v4.

## `next.config.ts`

- Config base de Next.js (sin overrides personalizados por ahora).

## `pnpm-workspace.yaml`

- Ajustes de workspace pnpm (dependencias ignoradas en build).

---

## 10) Flujo funcional extremo a extremo

1. Usuario entra a `/`.
2. Se inicializa identidad local (session) y se cargan IDs conocidos (localStorage).
3. Al crear documento, frontend llama `POST /documents` con `x-user-id`.
4. El backend crea snapshot vacío + metadata owner.
5. En `/doc/:id`, `useCollaborativeDocument` verifica existencia y conecta WebSocket.
6. TipTap edita sobre `Y.XmlFragment`; cambios se propagan vía Yjs sync messages.
7. Awareness distribuye usuario/color/typing/cursor.
8. Historial local registra eventos en `sessionStorage`.
9. Backend debouncea persistencia a disco y aplica límites operativos.

---

## 11) Decisiones técnicas destacables

- **Sin auth fuerte**: se usa `x-user-id` + identidad de sesión para simplicidad de portafolio.
- **Biblioteca local por navegador**: evita backend de cuentas/ACL para MVP.
- **Undo/redo local desactivado en TipTap**: reduce inconsistencias con colaboración CRDT.
- **Persistencia por snapshot completo**: implementación más simple que un log incremental.
- **Límites defensivos en servidor**: protegen estabilidad en entornos de despliegue pequeños.

---

## 12) Observaciones y posibles mejoras

1. Implementar autorización real para `DELETE /documents/:id` (hoy `canDeleteDocument()` retorna `true`).
2. Migrar historial de cambios a backend si se requiere auditoría compartida real.
3. Añadir pruebas automáticas para server realtime (límites, cuota, API).
4. Definir ownership/ACL por documento también a nivel WebSocket upgrade.
5. Registrar más granularidad de eventos (insert/delete/format reales) en historial.

---

Si quieres, en el siguiente paso te puedo generar además:
- **Diagrama de arquitectura** (frontend ↔ websocket ↔ persistencia).
- **Glosario ampliado** de cada dependencia externa.
- **Manual de onboarding** para nuevos desarrolladores.
