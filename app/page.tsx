"use client";

import {
  forgetDocumentId,
  getKnownDocumentIds,
  rememberDocumentId,
} from "@/lib/library";
import { createDocumentId } from "@/lib/document";
import {
  getLocalCollaboratorIdentity,
  getLocalCollaboratorName,
  setLocalCollaboratorName,
} from "@/lib/presence";
import { getRealtimeHttpServerUrl } from "@/lib/websocket";
import type { DocumentDirectoryItem } from "@/types/document";
import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

const DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "Fecha desconocida";
  }

  return dateFormatter.format(new Date(timestamp));
}

function formatSize(value: number) {
  if (value <= 0) {
    return "0 B";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round((value / 1024) * 10) / 10} KB`;
  }

  return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
}

type FetchMode = "initial" | "refresh";

function sortDocumentsByUpdate(documents: DocumentDirectoryItem[]) {
  return [...documents].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export default function Home() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getRealtimeHttpServerUrl(), []);
  const [documents, setDocuments] = useState<DocumentDirectoryItem[]>([]);
  const [manualDocumentId, setManualDocumentId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collaboratorName, setCollaboratorName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadDocuments = useCallback(
    async (mode: FetchMode) => {
      if (mode === "initial") {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const knownIds = getKnownDocumentIds();
        if (knownIds.length === 0) {
          setDocuments([]);
          setError(null);
          return;
        }

        const resolvedDocuments = await Promise.all(
          knownIds.map(async (documentId) => {
            try {
              const response = await fetch(
                `${apiBaseUrl}/documents/${encodeURIComponent(documentId)}`,
                {
                  method: "GET",
                  cache: "no-store",
                  headers: currentUserId
                    ? {
                        "x-user-id": currentUserId,
                      }
                    : undefined,
                },
              );

              if (!response.ok) {
                return null;
              }

              const payload = (await response.json()) as {
                document?: DocumentDirectoryItem;
              };

              return payload.document ?? null;
            } catch {
              return null;
            }
          }),
        );

        const existingDocuments = sortDocumentsByUpdate(
          resolvedDocuments.filter(
            (document): document is DocumentDirectoryItem => document !== null,
          ),
        );

        const existingIds = new Set(existingDocuments.map((document) => document.id));
        for (const documentId of knownIds) {
          if (!existingIds.has(documentId)) {
            forgetDocumentId(documentId);
          }
        }

        setDocuments(existingDocuments);
        setError(null);
      } catch {
        setError(
          "No se pudo cargar la biblioteca de documentos. Verifica que el server realtime esté activo.",
        );
      } finally {
        if (mode === "initial") {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [apiBaseUrl, currentUserId],
  );

  useEffect(() => {
    void loadDocuments("initial");
  }, [loadDocuments]);

  useEffect(() => {
    const identity = getLocalCollaboratorIdentity();
    setCurrentUserId(identity.id);
    setCollaboratorName(getLocalCollaboratorName());
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDocuments("refresh");
      }
    }, 4000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadDocuments("refresh");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDocuments]);

  const normalizedManualId = manualDocumentId.trim();
  const hasManualIdError =
    normalizedManualId.length > 0 && !DOCUMENT_ID_PATTERN.test(normalizedManualId);

  const handleOpenDocumentById = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!DOCUMENT_ID_PATTERN.test(normalizedManualId)) {
      return;
    }

    rememberDocumentId(normalizedManualId);
    router.push(`/doc/${normalizedManualId}`);
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!currentUserId) {
      setError("No se pudo validar tu usuario para borrar este documento.");
      return;
    }

    const confirmed = window.confirm(
      `Vas a eliminar el documento "${documentId}". Esta acción no se puede deshacer. ¿Continuar?`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingId(documentId);
    try {
      const response = await fetch(
        `${apiBaseUrl}/documents/${encodeURIComponent(documentId)}`,
        {
          method: "DELETE",
          headers: {
            "x-user-id": currentUserId,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }

      setDocuments((previous) =>
        previous.filter((document) => document.id !== documentId),
      );
      forgetDocumentId(documentId);
    } catch {
      setError(`No se pudo borrar el documento "${documentId}".`);
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleCreateDocument = async () => {
    if (!currentUserId) {
      setError("No se pudo crear el documento: usuario no inicializado.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const maxAttempts = 5;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const documentId = createDocumentId();

        const response = await fetch(`${apiBaseUrl}/documents`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": currentUserId,
          },
          body: JSON.stringify({ id: documentId }),
        });

        if (response.status === 409) {
          continue;
        }

        if (response.status === 429) {
          setError(
            "Alcanzaste el límite de documentos creados para este usuario.",
          );
          return;
        }

        if (!response.ok) {
          throw new Error(`http_${response.status}`);
        }

        rememberDocumentId(documentId);
        router.push(`/doc/${documentId}`);
        return;
      }

      setError("No se pudo crear un ID único para el documento.");
    } catch {
      setError("No se pudo crear el documento. Intenta nuevamente.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveCollaboratorName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const updatedIdentity = setLocalCollaboratorName(collaboratorName);
    if (!updatedIdentity) {
      setNameError("Ingresa un nombre válido.");
      setNameSaved(false);
      return;
    }

    setCollaboratorName(updatedIdentity.name);
    setNameError(null);
    setNameSaved(true);
    window.setTimeout(() => {
      setNameSaved(false);
    }, 1400);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
      <section className="surface-card animate-fade-up space-y-6 p-6 sm:p-8">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="ui-label">Realtime Workspace</p>
            <ThemeToggle />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
            Documentos colaborativos,
            <span className="block text-zinc-600">sin fricción.</span>
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 sm:text-base">
            Combina edición en tiempo real con una biblioteca simple para abrir y
            limpiar documentos antes del deploy.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handleCreateDocument();
            }}
            disabled={!currentUserId || isCreating}
            className="btn btn-primary"
          >
            {isCreating ? "Creando..." : "Crear documento"}
          </button>
          <button
            type="button"
            onClick={() => void loadDocuments("refresh")}
            disabled={isRefreshing}
            className="btn btn-secondary"
          >
            {isRefreshing ? "Actualizando..." : "Actualizar biblioteca"}
          </button>
        </div>

        <form
          className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-[1fr_auto]"
          onSubmit={handleSaveCollaboratorName}
        >
          <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
            Tu nombre en colaboración
            <input
              value={collaboratorName}
              onChange={(event) => {
                setCollaboratorName(event.target.value);
                if (nameError) {
                  setNameError(null);
                }
              }}
              placeholder="Ej: Ana"
              className={[
                "h-11 rounded-lg border bg-white px-3 text-sm text-zinc-900 outline-none",
                nameError
                  ? "border-red-400 ring-2 ring-red-100"
                  : "border-zinc-300 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-200",
              ].join(" ")}
              maxLength={32}
            />
          </label>
          <button
            type="submit"
            disabled={collaboratorName.trim().length === 0}
            className="btn btn-secondary self-end"
          >
            Guardar nombre
          </button>
          {nameError ? (
            <p className="text-xs font-medium text-red-600 sm:col-span-2">
              {nameError}
            </p>
          ) : null}
          {nameSaved ? (
            <p className="text-xs font-medium text-emerald-700 sm:col-span-2">
              Nombre actualizado para esta pestaña.
            </p>
          ) : null}
        </form>

        <form
          className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-[1fr_auto]"
          onSubmit={handleOpenDocumentById}
        >
          <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
            Abrir por ID
            <input
              value={manualDocumentId}
              onChange={(event) => {
                setManualDocumentId(event.target.value);
              }}
              placeholder="ej: demo-doc-001"
              className={[
                "h-11 rounded-lg border bg-white px-3 text-sm text-zinc-900 outline-none",
                hasManualIdError
                  ? "border-red-400 ring-2 ring-red-100"
                  : "border-zinc-300 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-200",
              ].join(" ")}
            />
          </label>
          <button
            type="submit"
            disabled={hasManualIdError || normalizedManualId.length === 0}
            className="btn btn-secondary self-end"
          >
            Abrir
          </button>
        </form>
      </section>

      <section className="surface-card animate-fade-up p-6 sm:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-900">
            Biblioteca privada de documentos
          </h2>
          <span className="status-pill">
            {documents.length} {documents.length === 1 ? "documento" : "documentos"}
          </span>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            Cargando documentos...
          </p>
        ) : null}

        {!isLoading && documents.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            Tu biblioteca privada está vacía. Crea un documento o abre uno por link/ID.
          </p>
        ) : null}

        {!isLoading && documents.length > 0 ? (
          <ul className="space-y-3">
            {documents.map((document) => (
              <li
                key={document.id}
                className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-[1fr_auto]"
              >
                <div className="space-y-1">
                  <p className="font-mono text-sm font-semibold text-zinc-900">
                    {document.id}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Actualizado: {formatTimestamp(document.updatedAt)} ·{" "}
                    {formatSize(document.sizeBytes)}
                  </p>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Estado: {document.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/doc/${document.id}`} className="btn btn-secondary">
                    Abrir
                  </Link>
                  {document.canDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeleteDocument(document.id);
                      }}
                      disabled={isDeletingId === document.id}
                      className="btn btn-danger"
                    >
                      {isDeletingId === document.id ? "Borrando..." : "Borrar"}
                    </button>
                  ) : (
                    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-500">
                      Solo creador
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
