import type { UserModel } from "@/types/user";
import UserCursor from "./UserCursor";

type UserPresenceProps = {
  users: UserModel[];
};

export default function UserPresence({ users }: UserPresenceProps) {
  return (
    <aside className="surface-card p-3">
      <h2 className="mb-2 text-sm font-semibold text-zinc-800">
        Online Users ({users.length})
      </h2>
      <ul className="space-y-2 text-sm text-zinc-600">
        {users.length === 0 ? (
          <li className="surface-muted px-2 py-1.5">Sin usuarios conectados.</li>
        ) : null}
        {users.map((user) => (
          <li
            key={`${user.clientId}-${user.id}`}
            className="surface-muted flex items-center px-2 py-1.5"
          >
            <UserCursor
              name={user.name}
              color={user.color}
              isCurrentUser={user.isCurrentUser}
              isTyping={user.isTyping}
            />
          </li>
        ))}
      </ul>
    </aside>
  );
}
