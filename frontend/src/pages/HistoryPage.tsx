import { HistoryPanel } from '../components/HistoryPanel'

export function HistoryPage() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Module 10</p>
        <h1 className="page-title">History &amp; Reports</h1>
        <p className="page-lede">
          Every full analysis of your repositories, how the health score changed between them, and
          PDF reports of any analysis to download and share.
        </p>
      </div>
      <HistoryPanel repository={null} />
    </div>
  )
}
