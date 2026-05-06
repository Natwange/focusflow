"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Palette,
  User,
  X,
  ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import type { ThemePreference } from "@/lib/themeStorage";

type SectionId = "account" | "appearance";

type SettingsModalContextValue = {
  openSettings: () => void;
  closeSettings: () => void;
  isOpen: boolean;
};

const SettingsModalContext = createContext<SettingsModalContextValue | null>(
  null
);

export function useSettingsModal(): SettingsModalContextValue {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) {
    throw new Error("useSettingsModal must be used within SettingsModalProvider");
  }
  return ctx;
}

export function SettingsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openSettings = useCallback(() => setIsOpen(true), []);
  const closeSettings = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ openSettings, closeSettings, isOpen }),
    [openSettings, closeSettings, isOpen]
  );

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
      {isOpen && (
        <SettingsModalShell onClose={closeSettings} />
      )}
    </SettingsModalContext.Provider>
  );
}

function SettingsModalShell({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const [section, setSection] = useState<SectionId>("account");

  const [email, setEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifySubmitting, setVerifySubmitting] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwMessage, setPwMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  useEffect(() => {
    api("/me")
      .then((data) => {
        const em = data?.user?.email;
        setEmail(typeof em === "string" ? em : null);
        setEmailVerified(data?.user?.emailVerified !== false);
        setLoadError(null);
        setVerifyMsg(null);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "Authentication required") {
          onClose();
          router.replace("/login");
          return;
        }
        setLoadError("Could not load account.");
      });
  }, [onClose, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleResendVerification = useCallback(async () => {
    setVerifyMsg(null);
    setVerifySubmitting(true);
    try {
      const data = await api("/auth/resend-verification-email", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setVerifyMsg(
        typeof data?.message === "string" ? data.message : "Email sent."
      );
    } catch (e: unknown) {
      setVerifyMsg(
        e instanceof Error ? e.message : "Could not send verification email."
      );
    } finally {
      setVerifySubmitting(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Still navigate away; cookie may already be invalid
    }
    onClose();
    router.replace("/login");
    router.refresh();
  }, [onClose, router]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMessage(null);
    if (newPassword.length < 8) {
      setPwMessage({
        type: "err",
        text: "New password must be at least 8 characters.",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMessage({
        type: "err",
        text: "New password and confirmation do not match.",
      });
      return;
    }
    setPwSubmitting(true);
    try {
      await api("/me/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPwMessage({ type: "ok", text: "Password updated." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Could not update password.";
      setPwMessage({ type: "err", text });
    } finally {
      setPwSubmitting(false);
    }
  };

  const navItems: {
    id: SectionId;
    label: string;
    icon: typeof User;
  }[] = [
    { id: "account", label: "Account", icon: User },
    { id: "appearance", label: "Appearance", icon: Palette },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        aria-label="Close settings"
        onClick={onClose}
      />
      <div
        className="relative z-[101] isolate flex w-full max-w-3xl max-h-[min(90vh,720px)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950 sm:w-52 sm:border-b-0 sm:border-r">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <nav className="flex flex-col gap-1">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                  section === id
                    ? "bg-neutral-100 text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100"
                }`}
              >
                <Icon size={18} className="shrink-0 opacity-80" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-neutral-950">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800 sm:px-6">
            <h2
              id="settings-modal-title"
              className="text-lg font-semibold tracking-tight"
            >
              {section === "account" ? "Account" : "Appearance"}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              {section === "account"
                ? "Email, password, and sign out."
                : "How Focusflow looks on this device."}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
            {section === "account" && (
              <div className="space-y-8">
                {!emailVerified && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/40 sm:p-5">
                    <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                      Verify your email
                    </p>
                    <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/90">
                      We sent a link when you signed up. Confirm your address so
                      you can recover your account if you forget your password.
                    </p>
                    <button
                      type="button"
                      disabled={verifySubmitting}
                      onClick={handleResendVerification}
                      className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-amber-200 dark:text-amber-950"
                    >
                      {verifySubmitting ? "Sending…" : "Resend verification email"}
                    </button>
                    {verifyMsg && (
                      <p className="mt-2 text-xs text-amber-900 dark:text-amber-100/90">
                        {verifyMsg}
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900 sm:p-5">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Your account
                  </p>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Signed in as{" "}
                    {loadError ? (
                      <span className="text-red-600 dark:text-red-400">
                        {loadError}
                      </span>
                    ) : email ? (
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {email}
                      </span>
                    ) : (
                      "…"
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Change password
                  </h3>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    Use a strong password you don&apos;t use elsewhere.
                  </p>
                  <form
                    onSubmit={handleChangePassword}
                    className="mt-4 space-y-3"
                  >
                    <div>
                      <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                        Current password
                      </label>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-neutral-900/10 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                        New password
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-neutral-900/10 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10"
                        minLength={8}
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                        Confirm new password
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-neutral-900/10 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10"
                        minLength={8}
                        required
                      />
                    </div>
                    {pwMessage && (
                      <p
                        className={
                          pwMessage.type === "ok"
                            ? "text-sm text-green-600 dark:text-green-400"
                            : "text-sm text-red-600 dark:text-red-400"
                        }
                      >
                        {pwMessage.text}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={pwSubmitting}
                      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      {pwSubmitting ? "Updating…" : "Update password"}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {section === "appearance" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      Theme
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      Light, dark, or follow your system setting.
                    </p>
                  </div>
                  <div className="relative shrink-0 sm:w-44">
                    <select
                      value={preference}
                      onChange={(e) =>
                        setPreference(e.target.value as ThemePreference)
                      }
                      className="w-full appearance-none rounded-lg border border-neutral-200 bg-white py-2 pl-3 pr-9 text-sm text-neutral-900 outline-none ring-neutral-900/10 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10"
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="system">System</option>
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500 opacity-70 dark:text-neutral-400"
                      aria-hidden
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
