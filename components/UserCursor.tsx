type UserCursorProps = {
  name: string;
  color: string;
  isCurrentUser: boolean;
  isTyping: boolean;
};

export default function UserCursor({
  name,
  color,
  isCurrentUser,
  isTyping,
}: UserCursorProps) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700">
      <span
        className={[
          "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white transition-transform",
          isTyping ? "scale-105" : "",
        ].join(" ")}
        style={{ backgroundColor: color }}
        aria-label={`Avatar ${name}`}
      >
        {initials}
      </span>
      <span>{name}</span>
      {isCurrentUser ? (
        <span className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
          Tú
        </span>
      ) : null}
      {isTyping ? (
        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700">
          typing
        </span>
      ) : null}
    </div>
  );
}
