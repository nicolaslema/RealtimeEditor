import DocumentEditor from "@/components/Editor";
import DocumentHeader from "@/components/DocumentHeader";
import { isValidDocumentId } from "@/lib/document";
import { getRealtimeHttpServerUrl } from "@/lib/websocket";
import { notFound } from "next/navigation";

type DocumentPageProps = {
  params: Promise<{ id: string }>;
};

async function assertDocumentExists(documentId: string) {
  try {
    const response = await fetch(
      `${getRealtimeHttpServerUrl()}/documents/${encodeURIComponent(documentId)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      notFound();
    }
  } catch {
    notFound();
  }
}

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params;

  if (!isValidDocumentId(id)) {
    notFound();
  }

  await assertDocumentExists(id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <DocumentHeader documentId={id} />
      <DocumentEditor documentId={id} />
    </main>
  );
}
