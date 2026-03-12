"use client";

import { readDocumentHistory } from "@/lib/document-history";
import type { DocumentChangeEvent } from "@/types/document";
import Link from "next/link";
import { useEffect, useState } from "react";

type DocumentHistoryViewProps = {
  documentId: string;
};

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : timeFormatter.format(date);
}

export default function DocumentHistoryView({
  documentId,
}: DocumentHistoryViewProps) {
  const [events, setEvents] = useState<DocumentChangeEvent[]>([]);

  useEffect(() => {
    const syncEvents = () => {
      setEvents(readDocumentHistory(documentId));
    };

    syncEvents();

    const intervalId = window.setInterval(syncEvents, 1200);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncEvents();
      }
    };

    window.addEventListener("storage", syncEvents);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("storage", syncEvents);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [documentId]);

  return (
    <section className="surface-card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900">
          Historial completo del documento
        </h2>
        <Link href={`/doc/${documentId}`} className="btn btn-secondary">
          Volver al editor
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
          Aún no hay cambios registrados para este documento.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={`${event.documentId}-${event.userId}-${event.timestamp}`}
              className="rounded-lg border border-zinc-200 bg-white p-3"
            >
              <p className="text-sm font-medium text-zinc-800">{event.summary}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatTimestamp(event.timestamp)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

