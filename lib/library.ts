import { isValidDocumentId } from "@/lib/document";

const LIBRARY_STORAGE_KEY = "collaborative-editor:library-documents";

function parseDocumentIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const ids = parsed.filter((value): value is string => typeof value === "string");
    return [...new Set(ids.filter((id) => isValidDocumentId(id)))];
  } catch {
    return [];
  }
}

export function getKnownDocumentIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  return parseDocumentIds(window.localStorage.getItem(LIBRARY_STORAGE_KEY));
}

function persistDocumentIds(nextIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(nextIds));
}

export function rememberDocumentId(documentId: string) {
  if (!isValidDocumentId(documentId)) {
    return;
  }

  const current = getKnownDocumentIds();
  if (current.includes(documentId)) {
    return;
  }

  persistDocumentIds([documentId, ...current].slice(0, 200));
}

export function forgetDocumentId(documentId: string) {
  const current = getKnownDocumentIds();
  const next = current.filter((id) => id !== documentId);
  persistDocumentIds(next);
}
