/** Shown during route transitions — avoids a blank white screen while chunks load. */
export default function Loading() {
  return (
    <div className="ff-page min-h-[50vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div
          className="h-8 w-8 rounded-full border-2 border-gray-300 border-t-gray-800 animate-spin"
          aria-hidden
        />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  );
}
