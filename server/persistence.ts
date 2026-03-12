import fs from "node:fs";
import path from "node:path";
import * as Y from "yjs";

const PERSISTENCE_DIR =
  process.env.WS_PERSISTENCE_DIR ??
  path.join(process.cwd(), "server", ".data", "documents");
const SAVE_DEBOUNCE_MS = Number(process.env.WS_SAVE_DEBOUNCE_MS ?? "700");

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

export type PersistedDocumentSnapshot = {
  id: string;
  updatedAt: string;
  sizeBytes: number;
  ownerId: string | null;
};

type PersistedDocumentMeta = {
  ownerId: string | null;
};

function ensurePersistenceDir() {
  fs.mkdirSync(PERSISTENCE_DIR, { recursive: true });
}

function getDocumentPath(documentId: string) {
  return path.join(PERSISTENCE_DIR, `${documentId}.bin`);
}

function getDocumentMetaPath(documentId: string) {
  return path.join(PERSISTENCE_DIR, `${documentId}.meta.json`);
}

function readPersistedMeta(documentId: string): PersistedDocumentMeta {
  const metaPath = getDocumentMetaPath(documentId);
  if (!fs.existsSync(metaPath)) {
    return { ownerId: null };
  }

  try {
    const raw = fs.readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as { ownerId?: unknown };
    const ownerId =
      typeof parsed.ownerId === "string" ? parsed.ownerId.trim() : null;

    return {
      ownerId: ownerId && ownerId.length > 0 ? ownerId : null,
    };
  } catch (error) {
    console.error(`[persistence] failed to read meta for ${documentId}`, error);
    return { ownerId: null };
  }
}

function writePersistedMeta(documentId: string, meta: PersistedDocumentMeta) {
  const metaPath = getDocumentMetaPath(documentId);
  fs.writeFileSync(metaPath, JSON.stringify(meta), { encoding: "utf-8" });
}

function toSnapshot(
  documentId: string,
  stats: fs.Stats,
  ownerId: string | null,
): PersistedDocumentSnapshot {
  return {
    id: documentId,
    updatedAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
    ownerId,
  };
}

function log(message: string) {
  console.log(`[persistence] ${message}`);
}

export function loadDocumentSnapshot(documentId: string, doc: Y.Doc) {
  ensurePersistenceDir();

  const filePath = getDocumentPath(documentId);
  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    const content = fs.readFileSync(filePath);
    if (content.length === 0) {
      return;
    }

    Y.applyUpdate(doc, new Uint8Array(content));
    log(`loaded snapshot for ${documentId}`);
  } catch (error) {
    console.error(`[persistence] failed to load ${documentId}`, error);
  }
}

function saveDocumentSnapshot(documentId: string, doc: Y.Doc) {
  ensurePersistenceDir();

  const filePath = getDocumentPath(documentId);

  try {
    const snapshot = Y.encodeStateAsUpdate(doc);
    fs.writeFileSync(filePath, Buffer.from(snapshot));
    log(`saved snapshot for ${documentId}`);
  } catch (error) {
    console.error(`[persistence] failed to save ${documentId}`, error);
  }
}

export function scheduleDocumentSave(documentId: string, doc: Y.Doc) {
  const existing = pendingSaves.get(documentId);
  if (existing) {
    clearTimeout(existing);
  }

  const timeoutId = setTimeout(() => {
    pendingSaves.delete(documentId);
    saveDocumentSnapshot(documentId, doc);
  }, SAVE_DEBOUNCE_MS);

  pendingSaves.set(documentId, timeoutId);
}

export function flushDocumentSave(documentId: string, doc: Y.Doc) {
  const existing = pendingSaves.get(documentId);
  if (existing) {
    clearTimeout(existing);
    pendingSaves.delete(documentId);
  }

  saveDocumentSnapshot(documentId, doc);
}

export function flushAllDocuments(activeDocs: Map<string, Y.Doc>) {
  for (const [docId, doc] of activeDocs) {
    flushDocumentSave(docId, doc);
  }
}

export function listPersistedDocuments(): PersistedDocumentSnapshot[] {
  ensurePersistenceDir();

  const entries = fs.readdirSync(PERSISTENCE_DIR, { withFileTypes: true });
  const documents: PersistedDocumentSnapshot[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".bin")) {
      continue;
    }

    const id = entry.name.slice(0, -4);
    const filePath = path.join(PERSISTENCE_DIR, entry.name);

    try {
      const stats = fs.statSync(filePath);
      documents.push(toSnapshot(id, stats, readPersistedMeta(id).ownerId));
    } catch (error) {
      console.error(`[persistence] failed to stat ${id}`, error);
    }
  }

  return documents.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function hasPersistedDocument(documentId: string): boolean {
  ensurePersistenceDir();
  return fs.existsSync(getDocumentPath(documentId));
}

export function getPersistedDocument(
  documentId: string,
): PersistedDocumentSnapshot | null {
  ensurePersistenceDir();

  const filePath = getDocumentPath(documentId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const stats = fs.statSync(filePath);
    return toSnapshot(documentId, stats, readPersistedMeta(documentId).ownerId);
  } catch (error) {
    console.error(`[persistence] failed to stat ${documentId}`, error);
    return null;
  }
}

export function createPersistedDocument(
  documentId: string,
  ownerId: string,
): PersistedDocumentSnapshot | null {
  ensurePersistenceDir();

  const filePath = getDocumentPath(documentId);
  if (fs.existsSync(filePath)) {
    return null;
  }

  try {
    const snapshot = Y.encodeStateAsUpdate(new Y.Doc());
    fs.writeFileSync(filePath, Buffer.from(snapshot), { flag: "wx" });
    writePersistedMeta(documentId, { ownerId });
    const stats = fs.statSync(filePath);
    log(`created snapshot for ${documentId}`);
    return toSnapshot(documentId, stats, ownerId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }

    console.error(`[persistence] failed to create ${documentId}`, error);
    return null;
  }
}

export function deletePersistedDocument(documentId: string): boolean {
  ensurePersistenceDir();

  const pending = pendingSaves.get(documentId);
  if (pending) {
    clearTimeout(pending);
    pendingSaves.delete(documentId);
  }

  const filePath = getDocumentPath(documentId);
  const metaPath = getDocumentMetaPath(documentId);

  const hasSnapshot = fs.existsSync(filePath);
  const hasMeta = fs.existsSync(metaPath);
  if (!hasSnapshot && !hasMeta) {
    return false;
  }

  try {
    fs.rmSync(filePath, { force: true });
    fs.rmSync(metaPath, { force: true });
    log(`deleted snapshot for ${documentId}`);
    return true;
  } catch (error) {
    console.error(`[persistence] failed to delete ${documentId}`, error);
    return false;
  }
}

export function getPersistedDocumentOwner(documentId: string): string | null {
  ensurePersistenceDir();
  return readPersistedMeta(documentId).ownerId;
}
