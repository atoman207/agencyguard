// Shown the moment a page under the app shell is opened, while its data loads.
//
// Every page folder re-exports this from its own loading.tsx. Next.js only
// treats a navigation as instant when the loading boundary sits inside the
// destination's own segment; one at the group level does not cover moving
// between sibling pages.
export function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded-lg bg-paper-deep" />
      <div className="mt-3 h-4 w-96 max-w-full rounded bg-paper-deep" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-line bg-white/70" />
        ))}
      </div>
      <div className="mt-6 h-72 rounded-xl border border-line bg-white/70" />
    </div>
  );
}
