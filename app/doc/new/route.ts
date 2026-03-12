import { NextRequest, NextResponse } from "next/server";
import { createDocumentId, getDocumentPath } from "@/lib/document";
import { getRealtimeHttpServerUrl } from "@/lib/websocket";

const MAX_CREATE_ATTEMPTS = 5;
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;

async function createDocument(documentId: string, ownerId: string) {
  const response = await fetch(`${getRealtimeHttpServerUrl()}/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": ownerId,
    },
    body: JSON.stringify({ id: documentId }),
    cache: "no-store",
  });

  return response.status;
}

export async function GET(request: NextRequest) {
  const ownerId = request.nextUrl.searchParams.get("owner")?.trim() ?? "";
  if (!USER_ID_PATTERN.test(ownerId)) {
    return NextResponse.json({ error: "invalid_owner_id" }, { status: 400 });
  }

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const documentId = createDocumentId();
    const status = await createDocument(documentId, ownerId);

    if (status === 201) {
      const location = new URL(getDocumentPath(documentId), request.url);
      return NextResponse.redirect(location);
    }

    if (status === 429) {
      return NextResponse.json(
        { error: "owner_document_quota_exceeded" },
        { status: 429 },
      );
    }

    if (status !== 409) {
      break;
    }
  }

  return NextResponse.json(
    { error: "no_se_pudo_crear_documento" },
    { status: 503 },
  );
}
