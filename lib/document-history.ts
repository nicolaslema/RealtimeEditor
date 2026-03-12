import type { DocumentChangeEvent, DocumentId } from "@/types/document";

const HISTORY_STORAGE_PREFIX = "collaborative-editor:history:";
const MAX_PERSISTED_HISTORY_ITEMS = 500;

function isDocumentChangeEvent(value: unknown): value is DocumentChangeEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    typeof event.documentId === "string" &&
    typeof event.userId === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.summary === "string" &&
    (event.type === "insert" || event.type === "delete" || event.type === "format")
  );
}

function getHistoryStorageKey(documentId: DocumentId) {
  return `${HISTORY_STORAGE_PREFIX}${documentId}`;
}

export function readDocumentHistory(documentId: DocumentId): DocumentChangeEvent[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(getHistoryStorageKey(documentId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isDocumentChangeEvent)
      .slice(0, MAX_PERSISTED_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function writeDocumentHistory(
  documentId: DocumentId,
  events: DocumentChangeEvent[],
) {
  if (typeof window === "undefined") {
    return;
  }

  const limited = events.slice(0, MAX_PERSISTED_HISTORY_ITEMS);
  window.sessionStorage.setItem(
    getHistoryStorageKey(documentId),
    JSON.stringify(limited),
  );
}

