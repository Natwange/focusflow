"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  applyThemeToDocument,
  readThemePreference,
  writeThemePreference,
  type ThemePreference,
} from "@/lib/themeStorage";

const PUBLIC_LIGHT_ONLY = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [preference, setPreferenceState] = useState<ThemePreference>("light");

  const syncDocumentTheme = useCallback(() => {
    if (PUBLIC_LIGHT_ONLY.has(pathname)) {
      document.documentElement.classList.remove("dark");
      return;
    }
    applyThemeToDocument(preference);
  }, [pathname, preference]);

  useEffect(() => {
    setPreferenceState(readThemePreference());
  }, []);

  useEffect(() => {
    writeThemePreference(preference);
  }, [preference]);

  useEffect(() => {
    syncDocumentTheme();
  }, [syncDocumentTheme]);

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => syncDocumentTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference, syncDocumentTheme]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
