import { Cpu, FileArchive, UploadCloud } from 'lucide-react'
import { useId, useState, type DragEvent } from 'react'

import { formatBytes } from '../utils/format'

const PINS = [0, 1, 2, 3, 4, 5, 6]

/**
 * The ZIP drop target, drawn as a chip socket: drag an archive over it and the socket lights
 * up; drop it (or click to browse) and the archive sits in the socket as a chip. The file input
 * stays in the page, labelled "ZIP archive", so keyboards and screen readers use it directly.
 */
export function ZipSocket({
  file,
  onFile,
  disabled,
}: {
  file: File | null
  onFile: (file: File | null) => void
  disabled: boolean
}) {
  const id = useId()
  const [over, setOver] = useState(false)
  const wrongType = file !== null && !file.name.toLowerCase().endsWith('.zip')

  function onDragOver(event: DragEvent) {
    if (disabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setOver(true)
  }
  function onDrop(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    if (disabled) return
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) onFile(dropped)
  }

  const lit = over || (file !== null && !wrongType)
  const pinColor = `rounded-sm transition-colors duration-300 ${lit ? 'bg-indigo-400' : wrongType ? 'bg-red-400/70' : 'bg-slate-700'}`
  const pin = `h-2 w-[3px] ${pinColor}`
  const sidePin = `h-[3px] w-2 ${pinColor}`
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium text-slate-300">
        ZIP archive
      </label>
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className="relative mt-2 px-3 py-3"
      >
        {/* Pins on all four sides, lit while a file hovers or sits in the socket. */}
        <div aria-hidden="true" className="absolute inset-x-10 top-0 flex justify-between">
          {PINS.map((p) => <span key={p} className={pin} />)}
        </div>
        <div aria-hidden="true" className="absolute inset-x-10 bottom-0 flex justify-between">
          {PINS.map((p) => <span key={p} className={pin} />)}
        </div>
        <div aria-hidden="true" className="absolute inset-y-6 left-0 flex flex-col justify-between">
          {PINS.slice(0, 4).map((p) => <span key={p} className={sidePin} />)}
        </div>
        <div aria-hidden="true" className="absolute inset-y-6 right-0 flex flex-col justify-between">
          {PINS.slice(0, 4).map((p) => <span key={p} className={sidePin} />)}
        </div>

        <label
          htmlFor={id}
          className={`relative flex min-h-[148px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 px-6 py-6 text-center transition duration-300 ${
            over
              ? 'scale-[1.01] border-dashed border-indigo-400 bg-indigo-500/10 shadow-[0_0_32px_rgb(var(--indigo-500)/0.25)]'
              : wrongType
                ? 'border-dashed border-red-500/60 bg-red-500/5'
                : file
                  ? 'border-solid border-indigo-500/60 bg-slate-950 shadow-[inset_0_0_24px_rgb(var(--indigo-500)/0.08)]'
                  : 'border-dashed border-slate-700 bg-slate-950/60 hover:border-slate-500'
          } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
        >
          {file ? (
            <span key={file.name + file.size} className="flex animate-pop-in items-center gap-3 text-left">
              <span
                className={`inline-flex h-12 w-12 items-center justify-center rounded-lg border ${wrongType ? 'border-red-500/60 text-red-300' : 'border-indigo-500 bg-indigo-500/10 text-indigo-300 shadow-[0_0_18px_rgb(var(--indigo-500)/0.35)]'}`}
              >
                {wrongType ? <FileArchive className="h-6 w-6" aria-hidden="true" /> : <Cpu className="h-6 w-6" aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="block max-w-[16rem] truncate font-mono text-sm text-slate-100">{file.name}</span>
                <span className={`block text-xs ${wrongType ? 'text-red-300' : 'text-slate-400'}`}>
                  {wrongType ? 'Not a .zip archive' : `${formatBytes(file.size)} · plugged in`}
                  {!disabled && <span className="text-slate-500"> · click to change</span>}
                </span>
              </span>
            </span>
          ) : (
            <>
              <UploadCloud className={`h-7 w-7 transition ${over ? '-translate-y-1 text-indigo-300' : 'text-slate-500'}`} aria-hidden="true" />
              <span className="font-medium text-slate-200">{over ? 'Release to plug it in' : 'Drop a ZIP here'}</span>
              <span className="text-xs text-slate-500">or click to browse</span>
            </>
          )}
        </label>
      </div>
      <input
        id={id}
        className="sr-only"
        type="file"
        accept=".zip,application/zip"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        disabled={disabled}
      />
    </div>
  )
}
