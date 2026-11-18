import { HistoryPanel } from '../components/HistoryPanel'

export function HistoryPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-sky-600/20 via-indigo-600/15 to-violet-500/10 p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">Module 10</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">History &amp; Reports</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Every full analysis of your repositories, how the health score changed between them, and
          PDF reports of any analysis to download and share.
        </p>
      </div>
      <HistoryPanel repository={null} />
    </div>
  )
}
