"use client";

import { getLocalCollaboratorIdentity } from "@/lib/presence";
import { getRealtimeHttpServerUrl, getWebSocketServerUrl } from "@/lib/websocket";
import { createYDoc, getXmlFragment } from "@/lib/yjs";
import type { CollaboratorIdentity } from "@/types/user";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import type * as Y from "yjs";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

type UseCollaborativeDocumentResult = {
  document: Y.Doc;
  fragment: Y.XmlFragment;
  provider: WebsocketProvider;
  awareness: Awareness;
  currentUser: CollaboratorIdentity;
  status: ConnectionStatus;
  isSynced: boolean;
  error: string | null;
};

export function useCollaborativeDocument(
  documentId: string,
): UseCollaborativeDocumentResult {
  const pendingDestroyRef = useRef<{
    timerId: number;
    provider: WebsocketProvider;
  } | null>(null);

  const resources = useMemo(() => {
    const document = createYDoc();
    const provider = new WebsocketProvider(
      getWebSocketServerUrl(),
      documentId,
      document,
      {
        connect: false,
        maxBackoffTime: 2500,
        resyncInterval: 5000,
      },
    );
    const awareness = provider.awareness as Awareness;
    const currentUser = getLocalCollaboratorIdentity();

    return {
      document,
      fragment: getXmlFragment(document),
      provider,
      awareness,
      currentUser,
    };
  }, [documentId]);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [isSynced, setIsSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pendingDestroy = pendingDestroyRef.current;
    if (pendingDestroy && pendingDestroy.provider === resources.provider) {
      window.clearTimeout(pendingDestroy.timerId);
      pendingDestroyRef.current = null;
    }

    const { provider, awareness, currentUser, document: ydoc } = resources;
    let cancelled = false;
    let connectRetryTimeout: number | null = null;

    const handleStatus = (event: { status: ConnectionStatus }) => {
      setStatus(event.status);
      if (event.status !== "disconnected") {
        setError(null);
      }
    };

    const handleSync = (synced: boolean) => {
      setIsSynced(synced);
    };

    const handleConnectionError = () => {
      setError("No se pudo conectar al servidor realtime.");
    };

    provider.on("status", handleStatus);
    provider.on("sync", handleSync);
    provider.on("connection-error", handleConnectionError);
    awareness.setLocalState({
      user: currentUser,
      isTyping: false,
    });

    const connectProvider = () => {
      if (cancelled) {
        return;
      }

      provider.connect();
    };

    const connectWithExistenceCheck = async () => {
      const maxAttempts = 15;
      const baseUrl = getRealtimeHttpServerUrl();

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled) {
          return;
        }

        try {
          const response = await fetch(
            `${baseUrl}/documents/${encodeURIComponent(documentId)}`,
            {
              method: "GET",
              cache: "no-store",
            },
          );

          if (response.ok) {
            connectProvider();
            return;
          }
        } catch {
          // keep retrying
        }

        await new Promise<void>((resolve) => {
          connectRetryTimeout = window.setTimeout(resolve, 180);
        });
      }

      if (!cancelled) {
        setError("No se pudo verificar el documento antes de conectar.");
      }
    };

    void connectWithExistenceCheck();

    const handleOnline = () => {
      connectProvider();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        connectProvider();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (connectRetryTimeout) {
        window.clearTimeout(connectRetryTimeout);
      }
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      awareness.setLocalState(null);
      provider.off("status", handleStatus);
      provider.off("sync", handleSync);
      provider.off("connection-error", handleConnectionError);

      provider.disconnect();

      const timerId = window.setTimeout(() => {
        provider.destroy();
        ydoc.destroy();

        if (pendingDestroyRef.current?.timerId === timerId) {
          pendingDestroyRef.current = null;
        }
      }, 0);

      pendingDestroyRef.current = {
        timerId,
        provider,
      };
    };
  }, [documentId, resources]);

  return {
    ...resources,
    status,
    isSynced,
    error,
  };
}
