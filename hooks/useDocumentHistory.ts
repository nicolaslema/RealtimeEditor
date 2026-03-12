"use client";

import { readDocumentHistory, writeDocumentHistory } from "@/lib/document-history";
import { isCollaboratorIdentity } from "@/lib/presence";
import type { DocumentChangeEvent } from "@/types/document";
import type { CollaboratorIdentity } from "@/types/user";
import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

type UseDocumentHistoryParams = {
  documentId: string;
  document: Y.Doc;
  awareness: Awareness;
  currentUser: CollaboratorIdentity;
  currentClientId: number;
};

type UseDocumentHistoryResult = {
  events: DocumentChangeEvent[];
};

const MAX_HISTORY_ITEMS = 500;
const MERGE_WINDOW_MS = 1200;

function resolveRemoteActor(
  awareness: Awareness,
  currentClientId: number,
): CollaboratorIdentity {
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === currentClientId) {
      continue;
    }

    const user = (state as { user?: unknown }).user;

    if (isCollaboratorIdentity(user)) {
      return user;
    }
  }

  return {
    id: "collaborator",
    name: "Un colaborador",
    color: "#64748B",
  };
}

function createHistoryEvent(
  documentId: string,
  userId: string,
  actorName: string,
): DocumentChangeEvent {
  return {
    documentId,
    userId,
    timestamp: new Date().toISOString(),
    type: "insert",
    summary: `${actorName} editó el documento`,
  };
}

export function useDocumentHistory({
  documentId,
  document,
  awareness,
  currentUser,
  currentClientId,
}: UseDocumentHistoryParams): UseDocumentHistoryResult {
  const [events, setEvents] = useState<DocumentChangeEvent[]>(() =>
    readDocumentHistory(documentId),
  );

  useEffect(() => {
    setEvents(readDocumentHistory(documentId));
  }, [documentId]);

  useEffect(() => {
    const handleUpdate = (
      _update: Uint8Array,
      _origin: unknown,
      _doc: Y.Doc,
      transaction: Y.Transaction,
    ) => {
      const isLocal = transaction.local;
      const actor = isLocal
        ? currentUser
        : resolveRemoteActor(awareness, currentClientId);
      const next = createHistoryEvent(documentId, actor.id, actor.name);

      setEvents((previousEvents) => {
        const latest = previousEvents[0];

        if (!latest) {
          const initial = [next];
          writeDocumentHistory(documentId, initial);
          return initial;
        }

        const latestTs = Date.parse(latest.timestamp);
        const nextTs = Date.parse(next.timestamp);
        const shouldMerge =
          latest.userId === next.userId && nextTs - latestTs < MERGE_WINDOW_MS;

        if (shouldMerge) {
          const merged = [
            { ...latest, timestamp: next.timestamp },
            ...previousEvents.slice(1),
          ];
          writeDocumentHistory(documentId, merged);
          return merged;
        }

        const updated = [next, ...previousEvents].slice(0, MAX_HISTORY_ITEMS);
        writeDocumentHistory(documentId, updated);
        return updated;
      });
    };

    document.on("update", handleUpdate);
    return () => {
      document.off("update", handleUpdate);
    };
  }, [awareness, currentClientId, currentUser, document, documentId]);

  return { events };
}
