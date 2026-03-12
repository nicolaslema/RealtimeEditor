"use client";

import { useCollaborativeDocument } from "@/hooks/useCollaborativeDocument";
import { useDocumentHistory } from "@/hooks/useDocumentHistory";
import { useUserPresence } from "@/hooks/useUserPresence";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Collaboration, {
  isChangeOrigin,
} from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo } from "react";
import ChangeHistory from "./ChangeHistory";
import Toolbar from "./Toolbar";
import UserPresence from "./UserPresence";

type DocumentEditorProps = {
  documentId: string;
};

type CollaborationTransaction = Parameters<typeof isChangeOrigin>[0];

function renderCursor(user: Record<string, unknown>) {
  const cursor = document.createElement("span");
  cursor.classList.add("collaboration-carets__caret");
  cursor.setAttribute("style", `border-color: ${String(user.color ?? "#999")}`);

  const label = document.createElement("div");
  label.classList.add("collaboration-carets__label");
  label.setAttribute(
    "style",
    `background-color: ${String(user.color ?? "#999")}`,
  );
  label.textContent = String(user.name ?? "User");

  cursor.append(label);
  return cursor;
}

export default function DocumentEditor({ documentId }: DocumentEditorProps) {
  const {
    document,
    fragment,
    provider,
    awareness,
    currentUser,
    status,
    isSynced,
    error,
  } = useCollaborativeDocument(documentId);
  const isReadyToEdit = isSynced;

  const users = useUserPresence(awareness, document.clientID).users;
  const { events } = useDocumentHistory({
    documentId,
    document,
    awareness,
    currentUser,
    currentClientId: document.clientID,
  });

  const extensions = useMemo(
    () => [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ fragment, document, provider }),
      CollaborationCaret.configure({
        provider,
        user: currentUser,
        render: renderCursor,
      }),
    ],
    [currentUser, document, fragment, provider],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editable: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-zinc max-w-none min-h-[420px] rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.03)] focus:outline-none sm:px-6 sm:py-5",
      },
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(isReadyToEdit);

    if (!isReadyToEdit) {
      awareness.setLocalStateField("isTyping", false);
    }
  }, [awareness, editor, isReadyToEdit]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    let typingTimeout: number | null = null;

    const handleTyping = ({
      transaction,
    }: {
      transaction: CollaborationTransaction;
    }) => {
      if (!transaction.docChanged || isChangeOrigin(transaction)) {
        return;
      }

      awareness.setLocalStateField("isTyping", true);

      if (typingTimeout) {
        window.clearTimeout(typingTimeout);
      }

      typingTimeout = window.setTimeout(() => {
        awareness.setLocalStateField("isTyping", false);
      }, 1200);
    };

    editor.on("transaction", handleTyping);

    return () => {
      if (typingTimeout) {
        window.clearTimeout(typingTimeout);
      }
      awareness.setLocalStateField("isTyping", false);
      editor.off("transaction", handleTyping);
    };
  }, [awareness, editor]);

  const typingUsers = users.filter((user) => user.isTyping && !user.isCurrentUser);
  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0].name} está escribiendo...`
        : `${typingUsers.map((user) => user.name).join(", ")} están escribiendo...`;

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3" data-document-id={documentId}>
        <div className="surface-muted flex flex-wrap items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-500">
          <span
            className={[
              "h-2 w-2 rounded-full",
              status === "connected" ? "bg-emerald-500" : "bg-amber-500",
            ].join(" ")}
            aria-hidden="true"
          />
          <span>Socket: {status}</span>
          <span>Sync: {isSynced ? "ok" : "pending"}</span>
          {error ? <span className="text-red-600">{error}</span> : null}
        </div>
        {typingLabel ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            {typingLabel}
          </p>
        ) : null}
        {!isReadyToEdit ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Sincronizando documento... espera el estado <strong>Sync: ok</strong>{" "}
            antes de editar.
          </p>
        ) : null}

        <div className="surface-card space-y-3 p-3 sm:p-4">
          <Toolbar editor={editor} />
          <EditorContent editor={editor} />
        </div>
      </div>

      <div className="space-y-3">
        <UserPresence users={users} />
        <ChangeHistory documentId={documentId} events={events} />
      </div>
    </section>
  );
}
