/** Short banner for auth/landing pages while FocusFlow runs reliability drills. */
export function MaintenanceNotice({ className = "" }: { className?: string }) {
  return (
    <p
      role="status"
      className={`rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${className}`}
    >
      FocusFlow is undergoing tests. If login fails, please try again shortly.
    </p>
  );
}
