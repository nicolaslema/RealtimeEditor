"use client";

import type { Editor } from "@tiptap/react";

type ToolbarProps = {
  editor: Editor | null;
};

function ToolbarButton({
  active = false,
  disabled = false,
  onClick,
  label,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors sm:text-[11px]",
        active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-900",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function Toolbar({ editor }: ToolbarProps) {
  if (!editor) {
    return (
      <div className="surface-muted p-2 text-sm text-zinc-500">
        Cargando editor...
      </div>
    );
  }

  return (
    <div className="surface-muted flex flex-wrap gap-2 p-2">
      <ToolbarButton
        label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
      />
      <ToolbarButton
        label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
      />
      <ToolbarButton
        label="H1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
      />
      <ToolbarButton
        label="H2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
      />
      <ToolbarButton
        label="Bullet List"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
      />
      <ToolbarButton
        label="Ordered List"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
      />
    </div>
  );
}
