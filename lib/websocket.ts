export type RealtimeMessage<TPayload = unknown> = {
  type: string;
  version: 1;
  documentId: string;
  userId: string;
  payload: TPayload;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function getWebSocketServerUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return trimTrailingSlash(process.env.NEXT_PUBLIC_WS_URL);
  }

  if (typeof window === "undefined") {
    return "ws://localhost:1234";
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:1234`;
}

export function getRealtimeHttpServerUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_HTTP_URL) {
    return trimTrailingSlash(process.env.NEXT_PUBLIC_WS_HTTP_URL);
  }

  const wsUrl = getWebSocketServerUrl();
  if (wsUrl.startsWith("ws://")) {
    return `http://${wsUrl.slice("ws://".length)}`;
  }
  if (wsUrl.startsWith("wss://")) {
    return `https://${wsUrl.slice("wss://".length)}`;
  }
  return wsUrl;
}
