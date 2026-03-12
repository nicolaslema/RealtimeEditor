"use client";

import { rememberDocumentId } from "@/lib/library";
import Link from "next/link";
import { useEffect, useState } from "react";

type DocumentHeaderProps = {
  documentId: string;
};

export default function DocumentHeader({ documentId }: DocumentHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    rememberDocumentId(documentId);
  }, [documentId]);

  const handleCopy = async () => {
    try {
      const shareUrl = `${window.location.origin}/doc/${documentId}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopyError(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(true);
      window.setTimeout(() => setCopyError(false), 1800);
    }
  };

  return (
    <header className="surface-card animate-fade-up flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="space-y-2">
        <p className="ui-label">Documento</p>
        <h1 className="font-mono text-lg font-semibold text-zinc-900 sm:text-xl">
          {documentId}
        </h1>
        <p className="text-xs text-zinc-500">
          Edición en tiempo real con presencia y sincronización instantánea.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className="btn btn-secondary">
          Biblioteca
        </Link>
        <button type="button" onClick={handleCopy} className="btn btn-primary">
          {copied ? "Link copiado" : copyError ? "Error al copiar" : "Copiar link"}
        </button>
      </div>
    </header>
  );
}
