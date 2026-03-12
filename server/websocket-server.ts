import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import http from "node:http";
import {
  createPersistedDocument,
  deletePersistedDocument,
  flushAllDocuments,
  flushDocumentSave,
  getPersistedDocument,
  getPersistedDocumentOwner,
  hasPersistedDocument,
  listPersistedDocuments,
  loadDocumentSnapshot,
  scheduleDocumentSave,
} from "./persistence";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as Y from "yjs";

const HOST = process.env.HOST ?? "localhost";
const PORT = Number(process.env.WS_PORT ?? process.env.PORT ?? "1234");
const DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;
const PING_TIMEOUT_MS = 30_000;
const CORS_ORIGIN = process.env.WS_CORS_ORIGIN ?? "*";
const MAX_DOCS_PER_OWNER = readPositiveInt("WS_MAX_DOCS_PER_OWNER",5);
const MAX_CONNECTIONS = readPositiveInt("WS_MAX_CONNECTIONS", 400);
const MAX_CONNECTIONS_PER_DOC = readPositiveInt("WS_MAX_CONNECTIONS_PER_DOC", 32);
const MAX_ACTIVE_DOCS = readPositiveInt("WS_MAX_ACTIVE_DOCS", 200);
const MAX_WS_MESSAGE_BYTES = readPositiveInt("WS_MAX_MESSAGE_BYTES", 1_048_576);
const DOC_IDLE_TTL_MS = readPositiveInt("WS_DOC_IDLE_TTL_MS", 5 * 60_000);
const DOC_EVICT_INTERVAL_MS = readPositiveInt("WS_DOC_EVICT_INTERVAL_MS", 30_000);
const MEMORY_SOFT_LIMIT_MB = readPositiveInt("WS_MEMORY_SOFT_LIMIT_MB", 768);

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

type DocumentDirectoryItem = {
  id: string;
  updatedAt: string;
  sizeBytes: number;
  status: "active" | "stored";
  canDelete: boolean;
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[ws] invalid ${name}="${raw}", using ${fallback}`);
    return fallback;
  }

  return Math.floor(parsed);
}

function getMemoryUsageMb() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / (1024 * 1024)),
    heapUsed: Math.round(usage.heapUsed / (1024 * 1024)),
  };
}

function readRequesterUserId(request: http.IncomingMessage): string | null {
  const headerValue = request.headers["x-user-id"];
  const rawUserId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (typeof rawUserId !== "string") {
    return null;
  }

  const normalized = rawUserId.trim();
  return USER_ID_PATTERN.test(normalized) ? normalized : null;
}

function canDeleteDocument(
  ownerId: string | null,
  requesterUserId: string | null,
): boolean {
  if (!ownerId) {
    // backward compatibility for legacy docs without owner metadata
    return true;
  }

  return requesterUserId === ownerId;
}

class SharedDoc extends Y.Doc {
  name: string;
  ownerId: string | null;
  conns: Map<WebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;
  lastActivityAt: number;

  constructor(name: string, ownerId: string | null) {
    super();
    this.name = name;
    this.ownerId = ownerId;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.lastActivityAt = Date.now();
    this.awareness.setLocalState(null);

    this.awareness.on(
      "update",
      (
        {
          added,
          updated,
          removed,
        }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changedClients = added.concat(updated, removed);

        if (origin && origin instanceof WebSocket) {
          const controlledIds = this.conns.get(origin);

          if (controlledIds) {
            for (const id of added.concat(updated)) {
              controlledIds.add(id);
            }

            for (const id of removed) {
              controlledIds.delete(id);
            }
          }
        }

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
        );
        const message = encoding.toUint8Array(encoder);
        this.lastActivityAt = Date.now();

        for (const conn of this.conns.keys()) {
          send(this, conn, message);
        }
      },
    );

    this.on("update", (update) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.lastActivityAt = Date.now();

      for (const conn of this.conns.keys()) {
        send(this, conn, message);
      }

      scheduleDocumentSave(this.name, this);
    });
  }
}

const docs = new Map<string, SharedDoc>();

function getTotalConnections() {
  let total = 0;
  for (const doc of docs.values()) {
    total += doc.conns.size;
  }
  return total;
}

function destroySharedDoc(doc: SharedDoc) {
  flushDocumentSave(doc.name, doc);
  docs.delete(doc.name);
  doc.destroy();
}

function evictIdleDocs(maxToEvict = Number.POSITIVE_INFINITY) {
  const now = Date.now();
  const candidates = [...docs.values()]
    .filter(
      (doc) => doc.conns.size === 0 && now - doc.lastActivityAt >= DOC_IDLE_TTL_MS,
    )
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt);

  let evicted = 0;
  for (const doc of candidates) {
    if (evicted >= maxToEvict) {
      break;
    }
    destroySharedDoc(doc);
    evicted += 1;
  }

  return evicted;
}

function ensureActiveDocCapacity() {
  if (docs.size < MAX_ACTIVE_DOCS) {
    return true;
  }

  const overflow = docs.size - MAX_ACTIVE_DOCS + 1;
  evictIdleDocs(overflow);

  return docs.size < MAX_ACTIVE_DOCS;
}

function isServerOverSoftMemoryLimit() {
  const { rss } = getMemoryUsageMb();
  return rss >= MEMORY_SOFT_LIMIT_MB;
}

function getDocument(docName: string) {
  let doc = docs.get(docName);

  if (!doc) {
    if (!ensureActiveDocCapacity()) {
      throw new Error("max_active_docs_reached");
    }

    const ownerId = getPersistedDocumentOwner(docName);
    doc = new SharedDoc(docName, ownerId);
    loadDocumentSnapshot(docName, doc);
    docs.set(docName, doc);
  }

  return doc;
}

function toUint8Array(message: RawData): Uint8Array {
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }

  if (Array.isArray(message)) {
    return new Uint8Array(Buffer.concat(message));
  }

  return new Uint8Array(message);
}

function closeConnection(doc: SharedDoc, conn: WebSocket) {
  if (!doc.conns.has(conn)) {
    return;
  }

  const controlledIds = doc.conns.get(conn);
  doc.conns.delete(conn);

  if (controlledIds && controlledIds.size > 0) {
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      [...controlledIds],
      null,
    );
  }

  doc.lastActivityAt = Date.now();

  if (doc.conns.size === 0) {
    destroySharedDoc(doc);
  }

  if (conn.readyState === conn.OPEN || conn.readyState === conn.CONNECTING) {
    conn.close();
  }
}

function send(doc: SharedDoc, conn: WebSocket, message: Uint8Array) {
  if (conn.readyState === conn.CONNECTING) {
    setTimeout(() => {
      if (doc.conns.has(conn)) {
        send(doc, conn, message);
      }
    }, 20);
    return;
  }

  if (conn.readyState !== conn.OPEN) {
    closeConnection(doc, conn);
    return;
  }

  try {
    conn.send(message, (error) => {
      if (error) {
        closeConnection(doc, conn);
      }
    });
  } catch {
    closeConnection(doc, conn);
  }
}

function handleMessage(doc: SharedDoc, conn: WebSocket, message: Uint8Array) {
  if (message.byteLength > MAX_WS_MESSAGE_BYTES) {
    conn.close(1009, "message_too_large");
    closeConnection(doc, conn);
    return;
  }

  doc.lastActivityAt = Date.now();

  try {
    const decoder = decoding.createDecoder(message);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC:
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);

        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      case MESSAGE_QUERY_AWARENESS: {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(doc.awareness, [
            ...doc.awareness.getStates().keys(),
          ]),
        );
        send(doc, conn, encoding.toUint8Array(awarenessEncoder));
        break;
      }
      default:
        break;
    }
  } catch {
    closeConnection(doc, conn);
  }
}

function setupConnection(conn: WebSocket, doc: SharedDoc) {
  if (getTotalConnections() >= MAX_CONNECTIONS) {
    conn.close(1013, "server_busy");
    return;
  }

  if (doc.conns.size >= MAX_CONNECTIONS_PER_DOC) {
    conn.close(1013, "doc_busy");
    return;
  }

  conn.binaryType = "arraybuffer";
  doc.conns.set(conn, new Set());
  doc.lastActivityAt = Date.now();

  conn.on("message", (message) => {
    handleMessage(doc, conn, toUint8Array(message));
  });

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!doc.conns.has(conn)) {
      clearInterval(pingInterval);
      return;
    }

    if (!pongReceived) {
      clearInterval(pingInterval);
      closeConnection(doc, conn);
      return;
    }

    pongReceived = false;
    try {
      conn.ping();
    } catch {
      clearInterval(pingInterval);
      closeConnection(doc, conn);
    }
  }, PING_TIMEOUT_MS);

  conn.on("pong", () => {
    pongReceived = true;
  });

  conn.on("close", () => {
    clearInterval(pingInterval);
    closeConnection(doc, conn);
  });

  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncEncoder, doc);
  send(doc, conn, encoding.toUint8Array(syncEncoder));

  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, [
        ...awarenessStates.keys(),
      ]),
    );
    send(doc, conn, encoding.toUint8Array(awarenessEncoder));
  }
}

function setCorsHeaders(response: http.ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Id");
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function countDocumentsOwnedBy(ownerId: string): number {
  const ownedIds = new Set<string>();

  for (const entry of listPersistedDocuments()) {
    if (entry.ownerId === ownerId) {
      ownedIds.add(entry.id);
    }
  }

  for (const [docId, doc] of docs) {
    if (doc.ownerId === ownerId) {
      ownedIds.add(docId);
    }
  }

  return ownedIds.size;
}

function buildDocumentDirectory(
  requesterUserId: string | null,
): DocumentDirectoryItem[] {
  const now = new Date().toISOString();
  const directoryById = new Map<string, DocumentDirectoryItem>();

  for (const entry of listPersistedDocuments()) {
    directoryById.set(entry.id, {
      ...entry,
      status: docs.has(entry.id) ? "active" : "stored",
      canDelete: canDeleteDocument(entry.ownerId, requesterUserId),
    });
  }

  for (const [docId, doc] of docs) {
    if (!directoryById.has(docId)) {
      directoryById.set(docId, {
        id: docId,
        updatedAt: now,
        sizeBytes: 0,
        status: "active",
        canDelete: canDeleteDocument(doc.ownerId, requesterUserId),
      });
    }
  }

  return [...directoryById.values()].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

function destroyDocumentSession(documentId: string): boolean {
  const doc = docs.get(documentId);
  if (!doc) {
    return false;
  }

  for (const connection of [...doc.conns.keys()]) {
    closeConnection(doc, connection);
  }

  const stillOpenDoc = docs.get(documentId);
  if (stillOpenDoc) {
    docs.delete(documentId);
    stillOpenDoc.destroy();
  }

  return true;
}

function isKnownDocument(documentId: string): boolean {
  return docs.has(documentId) || hasPersistedDocument(documentId);
}

const server = http.createServer((request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const host = request.headers.host ?? `${HOST}:${PORT}`;
  const requestUrl = new URL(request.url ?? "/", `http://${host}`);
  const pathname = requestUrl.pathname;
  const requesterUserId = readRequesterUserId(request);

  if (request.method === "GET" && pathname === "/documents") {
    sendJson(response, 200, { documents: buildDocumentDirectory(requesterUserId) });
    return;
  }

  if (request.method === "POST" && pathname === "/documents") {
    if (!requesterUserId) {
      sendJson(response, 400, { error: "invalid_user_id" });
      return;
    }

    if (countDocumentsOwnedBy(requesterUserId) >= MAX_DOCS_PER_OWNER) {
      sendJson(response, 429, {
        error: "owner_document_quota_exceeded",
        maxDocsPerOwner: MAX_DOCS_PER_OWNER,
      });
      return;
    }

    let requestBody = "";
    request.on("data", (chunk) => {
      requestBody += chunk.toString();
    });
    request.on("end", () => {
      try {
        const payload =
          requestBody.length === 0
            ? {}
            : (JSON.parse(requestBody) as { id?: unknown });
        const documentId =
          typeof payload.id === "string" ? payload.id.trim() : "";

        if (!DOCUMENT_ID_PATTERN.test(documentId)) {
          sendJson(response, 400, { error: "invalid_document_id" });
          return;
        }

        if (isKnownDocument(documentId)) {
          sendJson(response, 409, { error: "document_already_exists" });
          return;
        }

        const created = createPersistedDocument(documentId, requesterUserId);
        if (!created) {
          sendJson(response, 409, { error: "document_already_exists" });
          return;
        }

        sendJson(response, 201, {
          document: {
            ...created,
            status: "stored",
            canDelete: true,
          },
          ownerStats: {
            ownerId: requesterUserId,
            totalOwned: countDocumentsOwnedBy(requesterUserId),
            maxDocsPerOwner: MAX_DOCS_PER_OWNER,
          },
        });
      } catch {
        sendJson(response, 400, { error: "invalid_json" });
      }
    });
    request.on("error", () => {
      sendJson(response, 400, { error: "invalid_request" });
    });
    return;
  }

  if (request.method === "GET" && pathname.startsWith("/documents/")) {
    const documentId = decodeURIComponent(pathname.slice("/documents/".length));
    if (!DOCUMENT_ID_PATTERN.test(documentId)) {
      sendJson(response, 400, { error: "invalid_document_id" });
      return;
    }

    const activeDoc = docs.get(documentId);
    if (activeDoc) {
      sendJson(response, 200, {
        document: {
          id: documentId,
          updatedAt: new Date().toISOString(),
          sizeBytes: 0,
          status: "active",
          canDelete: canDeleteDocument(activeDoc.ownerId, requesterUserId),
        },
      });
      return;
    }

    const persisted = getPersistedDocument(documentId);
    if (!persisted) {
      sendJson(response, 404, { error: "document_not_found" });
      return;
    }

    sendJson(response, 200, {
      document: {
        ...persisted,
        status: "stored",
        canDelete: canDeleteDocument(persisted.ownerId, requesterUserId),
      },
    });
    return;
  }

  if (request.method === "DELETE" && pathname.startsWith("/documents/")) {
    if (!requesterUserId) {
      sendJson(response, 401, { error: "invalid_user_id" });
      return;
    }

    const documentId = decodeURIComponent(pathname.slice("/documents/".length));
    if (!DOCUMENT_ID_PATTERN.test(documentId)) {
      sendJson(response, 400, { error: "invalid_document_id" });
      return;
    }

    const activeDoc = docs.get(documentId);
    const ownerId =
      activeDoc?.ownerId ?? getPersistedDocumentOwner(documentId);

    if (!canDeleteDocument(ownerId, requesterUserId)) {
      sendJson(response, 403, { error: "forbidden_not_owner" });
      return;
    }

    const removedActiveDoc = destroyDocumentSession(documentId);
    const removedSnapshot = deletePersistedDocument(documentId);

    if (!removedActiveDoc && !removedSnapshot) {
      sendJson(response, 404, { error: "document_not_found" });
      return;
    }

    sendJson(response, 200, { ok: true, documentId });
    return;
  }

  if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
    sendJson(response, 200, {
      status: "ok",
      metrics: {
        activeDocs: docs.size,
        totalConnections: getTotalConnections(),
        memoryMb: getMemoryUsageMb(),
        limits: {
          maxConnections: MAX_CONNECTIONS,
          maxConnectionsPerDoc: MAX_CONNECTIONS_PER_DOC,
          maxActiveDocs: MAX_ACTIVE_DOCS,
          maxMessageBytes: MAX_WS_MESSAGE_BYTES,
          memorySoftLimitMb: MEMORY_SOFT_LIMIT_MB,
          maxDocsPerOwner: MAX_DOCS_PER_OWNER,
        },
      },
    });
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WS_MESSAGE_BYTES,
});

function rejectUpgrade(
  socket: NodeJS.WritableStream & { destroy: () => void },
  statusLine: string,
) {
  socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
  socket.destroy();
}

server.on("upgrade", (request, socket, head) => {
  const rawUrl = request.url ?? "";
  const docName = rawUrl.slice(1).split("?")[0];

  if (!DOCUMENT_ID_PATTERN.test(docName)) {
    rejectUpgrade(socket, "400 Bad Request");
    return;
  }

  if (!isKnownDocument(docName)) {
    rejectUpgrade(socket, "404 Not Found");
    return;
  }

  if (isServerOverSoftMemoryLimit()) {
    rejectUpgrade(socket, "503 Service Unavailable");
    return;
  }

  if (getTotalConnections() >= MAX_CONNECTIONS) {
    rejectUpgrade(socket, "503 Service Unavailable");
    return;
  }

  const existingDoc = docs.get(docName);
  if (existingDoc && existingDoc.conns.size >= MAX_CONNECTIONS_PER_DOC) {
    rejectUpgrade(socket, "429 Too Many Requests");
    return;
  }

  if (!existingDoc && !ensureActiveDocCapacity()) {
    rejectUpgrade(socket, "503 Service Unavailable");
    return;
  }

  wss.handleUpgrade(request, socket, head, (conn) => {
    try {
      setupConnection(conn, getDocument(docName));
    } catch {
      conn.close(1013, "server_busy");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Realtime websocket server running at ws://${HOST}:${PORT}`);
  console.log(
    `[ws] limits: connections=${MAX_CONNECTIONS}, perDoc=${MAX_CONNECTIONS_PER_DOC}, activeDocs=${MAX_ACTIVE_DOCS}, maxMessageBytes=${MAX_WS_MESSAGE_BYTES}, memorySoftLimitMb=${MEMORY_SOFT_LIMIT_MB}, docIdleTtlMs=${DOC_IDLE_TTL_MS}, maxDocsPerOwner=${MAX_DOCS_PER_OWNER}`,
  );
});

const docEvictionInterval = setInterval(() => {
  const evicted = evictIdleDocs();
  if (evicted > 0) {
    console.log(`[ws] evicted ${evicted} idle docs`);
  }
}, DOC_EVICT_INTERVAL_MS);
docEvictionInterval.unref();

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[ws] El puerto ${PORT} ya está en uso. Cierra el proceso dev:ws anterior y vuelve a intentar.`,
    );
    process.exit(1);
  }

  console.error("[ws] server error", error);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(docEvictionInterval);
    flushAllDocuments(docs);
    process.exit(0);
  });
}
