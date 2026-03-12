"use client";

import { useSyncExternalStore } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "collaborative-editor:theme";
const THEME_CHANGE_EVENT = "collaborative-editor:theme-change";

function applyTheme(nextTheme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", nextTheme);
  window.localStorage.setItem(STORAGE_KEY, nextTheme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function getClientTheme(): ThemeMode {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = () => callback();
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getClientTheme,
    () => "light",
  );

  const handleToggle = () => {
    const currentTheme = getClientTheme();
    const nextTheme: ThemeMode = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="theme-toggle"
      aria-label={isDark ? "Activar modo claro" : "Activar modo oscuro"}
      title={isDark ? "Modo claro" : "Modo oscuro"}
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      <span>{isDark ? "Claro" : "Oscuro"}</span>
    </button>
  );
}
