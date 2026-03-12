import type { CollaboratorIdentity } from "@/types/user";

const COLOR_PALETTE = [
  "#0EA5E9",
  "#22C55E",
  "#EF4444",
  "#F59E0B",
  "#8B5CF6",
  "#14B8A6",
  "#EC4899",
  "#6366F1",
];

export function createCollaboratorIdentity(clientId: number): CollaboratorIdentity {
  const suffix = clientId.toString(36).slice(-4).toUpperCase();
  return {
    id: `user-${suffix}`,
    name: `User ${suffix}`,
    color: COLOR_PALETTE[clientId % COLOR_PALETTE.length],
  };
}

const SESSION_USER_STORAGE_KEY = "collaborative-editor:session-user";
const COLLABORATOR_NAME_MAX_LENGTH = 32;

function hashString(value: string): number {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function createStableBrowserIdentity(): CollaboratorIdentity {
  const uid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const normalizedId = `user-${uid}`;
  const suffix = uid.slice(-4).toUpperCase();

  return {
    id: normalizedId,
    name: `User ${suffix}`,
    color: COLOR_PALETTE[hashString(normalizedId) % COLOR_PALETTE.length],
  };
}

export function getLocalCollaboratorIdentity(): CollaboratorIdentity {
  if (typeof window === "undefined") {
    return createStableBrowserIdentity();
  }

  const raw = window.sessionStorage.getItem(SESSION_USER_STORAGE_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isCollaboratorIdentity(parsed)) {
        return parsed;
      }
    } catch {
      // ignore malformed local storage data and recreate identity below
    }
  }

  const nextIdentity = createStableBrowserIdentity();
  window.sessionStorage.setItem(
    SESSION_USER_STORAGE_KEY,
    JSON.stringify(nextIdentity),
  );
  return nextIdentity;
}

function normalizeCollaboratorName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, COLLABORATOR_NAME_MAX_LENGTH);
}

export function getLocalCollaboratorName(): string {
  return getLocalCollaboratorIdentity().name;
}

export function setLocalCollaboratorName(
  nextName: string,
): CollaboratorIdentity | null {
  if (typeof window === "undefined") {
    return null;
  }

  const normalizedName = normalizeCollaboratorName(nextName);
  if (!normalizedName) {
    return null;
  }

  const currentIdentity = getLocalCollaboratorIdentity();
  const updatedIdentity: CollaboratorIdentity = {
    ...currentIdentity,
    name: normalizedName,
  };

  window.sessionStorage.setItem(
    SESSION_USER_STORAGE_KEY,
    JSON.stringify(updatedIdentity),
  );

  return updatedIdentity;
}

export function isCollaboratorIdentity(
  value: unknown,
): value is CollaboratorIdentity {
  if (!value || typeof value !== "object") {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.name === "string" &&
    typeof user.color === "string"
  );
}
