import type { DocumentId } from "@/types/document";

const DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;

export function createDocumentId(): DocumentId {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export function isValidDocumentId(documentId: string): documentId is DocumentId {
  return DOCUMENT_ID_PATTERN.test(documentId);
}

export function getDocumentPath(documentId: DocumentId): string {
  return `/doc/${documentId}`;
}
