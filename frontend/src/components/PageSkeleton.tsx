/** The shape of a page (header, stat tiles, two panels) while its file or data arrives. */
export function PageSkeleton({ label = 'Loading the page…' }: { label?: string }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-hidden="true" className="space-y-3 border-b border-slate-800 pb-6">
        <div className="skeleton h-3 w-32" />
        <div className="skeleton h-8 w-72" />
        <div className="skeleton h-3 w-full max-w-xl" />
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div key={tile} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
      <div aria-hidden="true" className="grid gap-4 lg:grid-cols-2">
        <div className="skeleton h-64 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    </div>
  )
}
