export type DocumentId = string;

export type DocumentModel = {
  id: DocumentId;
  title: string;
  updatedAt: string;
};

export type DocumentChangeEvent = {
  documentId: DocumentId;
  userId: string;
  timestamp: string;
  type: "insert" | "delete" | "format";
  summary: string;
};

export type DocumentDirectoryItem = {
  id: DocumentId;
  updatedAt: string;
  sizeBytes: number;
  status: "active" | "stored";
  canDelete: boolean;
};
