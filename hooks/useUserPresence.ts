"use client";

import { isCollaboratorIdentity } from "@/lib/presence";
import type { UserModel } from "@/types/user";
import { useMemo, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";

type UseUserPresenceResult = {
  users: UserModel[];
};

const EMPTY_USERS: UserModel[] = [];

function sortUsers(users: UserModel[]) {
  return [...users].sort((a, b) => {
    if (a.isCurrentUser && !b.isCurrentUser) {
      return -1;
    }

    if (!a.isCurrentUser && b.isCurrentUser) {
      return 1;
    }

    return a.name.localeCompare(b.name);
  });
}

function mapAwarenessToUsers(awareness: Awareness, currentClientId: number) {
  const users: UserModel[] = [];

  for (const [clientId, state] of awareness.getStates()) {
    const user = (state as { user?: unknown }).user;
    const isTyping = Boolean((state as { isTyping?: unknown }).isTyping);

    if (!isCollaboratorIdentity(user)) {
      continue;
    }

    users.push({
      ...user,
      clientId,
      status: "online",
      isCurrentUser: clientId === currentClientId,
      isTyping,
    });
  }

  return sortUsers(users);
}

export function useUserPresence(
  awareness: Awareness | null,
  currentClientId: number,
): UseUserPresenceResult {
  const store = useMemo(() => {
    if (!awareness) {
      return {
        subscribe: () => () => undefined,
        getSnapshot: () => EMPTY_USERS,
      };
    }

    let snapshot = mapAwarenessToUsers(awareness, currentClientId);

    return {
      subscribe: (callback: () => void) => {
        const handleAwarenessChange = () => {
          snapshot = mapAwarenessToUsers(awareness, currentClientId);
          callback();
        };

        awareness.on("change", handleAwarenessChange);
        return () => {
          awareness.off("change", handleAwarenessChange);
        };
      },
      getSnapshot: () => snapshot,
    };
  }, [awareness, currentClientId]);

  const users = useSyncExternalStore<UserModel[]>(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_USERS,
  );

  return { users };
}
