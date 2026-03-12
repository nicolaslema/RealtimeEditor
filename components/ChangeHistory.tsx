import type { DocumentChangeEvent } from "@/types/document";
import Link from "next/link";

type ChangeHistoryProps = {
  documentId: string;
  events: DocumentChangeEvent[];
};

const PREVIEW_LIMIT = 8;

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : timeFormatter.format(date);
}

export default function ChangeHistory({ documentId, events }: ChangeHistoryProps) {
  const previewEvents = events.slice(0, PREVIEW_LIMIT);

  return (
    <aside className="surface-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-800">Historial de cambios</h2>
        <Link
          href={`/doc/${documentId}/history`}
          className="text-[11px] font-semibold text-zinc-700 underline-offset-2 hover:underline"
        >
          Ver completo
        </Link>
      </div>
      <ul className="max-h-72 space-y-2 overflow-y-auto pr-1 text-xs text-zinc-600">
        {events.length === 0 ? (
          <li className="surface-muted p-2">Aún no hay cambios registrados.</li>
        ) : null}
        {previewEvents.map((event) => (
          <li
            key={`${event.documentId}-${event.userId}-${event.timestamp}`}
            className="rounded-lg border border-zinc-200 bg-white p-2 transition-colors hover:border-zinc-300"
          >
            <p className="font-medium text-zinc-800">{event.summary}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {formatTimestamp(event.timestamp)}
            </p>
          </li>
        ))}
      </ul>
      {events.length > PREVIEW_LIMIT ? (
        <p className="mt-2 text-[11px] font-medium text-zinc-500">
          Mostrando {PREVIEW_LIMIT} de {events.length} eventos.
        </p>
      ) : null}
    </aside>
  );
}
