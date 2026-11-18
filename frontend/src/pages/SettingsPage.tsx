import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, KeyRound, SlidersHorizontal, UserRound } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { PasswordField } from '../components/AuthLayout'
import { ErrorMessage } from '../components/ErrorMessage'
import { useAuth } from '../hooks/useAuth'
import { useChatStatus } from '../hooks/useChat'
import { queryKeys } from '../hooks/queryKeys'
import { changePassword, deleteAccount, getAccountSummary, updateProfile } from '../services/auth'
import { getErrorMessage } from '../services/client'
import type { User } from '../types/api'
import { formatDateTime } from '../utils/format'

export const MAX_DISPLAY_NAME = 80
export const MIN_PASSWORD = 8

const INPUT =
  'mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none'
const PRIMARY =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'

function Card({ title, icon, children, tone = 'default' }: { title: string; icon: ReactNode; children: ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <section
      aria-label={title}
      className={`space-y-4 rounded-2xl border p-6 ${tone === 'danger' ? 'border-red-500/30 bg-red-500/5' : 'border-slate-800 bg-slate-900/70'}`}
    >
      <h2 className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${tone === 'danger' ? 'text-red-200' : 'text-slate-200'}`}>
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}

function Profile({ user }: { user: User }) {
  const { updateUser } = useAuth()
  const [name, setName] = useState(user.display_name ?? '')
  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: (saved) => {
      updateUser(saved)
      setName(saved.display_name ?? '')
    },
  })
  const cleaned = name.trim().replace(/\s+/g, ' ')
  const changed = cleaned !== (user.display_name ?? '')
  const tooLong = cleaned.length > MAX_DISPLAY_NAME

  function submit(event: FormEvent) {
    event.preventDefault()
    if (changed && !tooLong) save.mutate(cleaned || null)
  }

  return (
    <Card title="Profile" icon={<UserRound className="h-4 w-4" aria-hidden="true" />}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-400">Email</dt>
          <dd className="break-all text-slate-100">{user.email}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Member since</dt>
          <dd className="text-slate-100">{formatDateTime(user.created_at)}</dd>
        </div>
      </dl>
      <form onSubmit={submit} aria-label="Change display name" className="space-y-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-300">Display name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Shown instead of your email"
            aria-invalid={tooLong}
            className={INPUT}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!changed || tooLong || save.isPending} className={PRIMARY}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <span className={`text-xs ${tooLong ? 'text-red-300' : 'text-slate-500'}`}>
            {cleaned.length} / {MAX_DISPLAY_NAME}
          </span>
          {save.isSuccess && !changed && <span role="status" className="text-xs text-emerald-300">Saved.</span>}
        </div>
        <ErrorMessage message={save.isError ? getErrorMessage(save.error, 'Could not save the name') : null} />
      </form>
    </Card>
  )
}

function Summary() {
  const summary = useQuery({ queryKey: queryKeys.accountSummary, queryFn: getAccountSummary })
  const items = summary.data
    ? [
        { label: 'Projects', value: summary.data.projects, to: '/projects' },
        { label: 'Repositories', value: summary.data.repositories, to: '/projects' },
        { label: 'Analyses', value: summary.data.analyses, to: '/history' },
        { label: 'PDF reports', value: summary.data.reports, to: '/history' },
        { label: 'Conversations', value: summary.data.conversations, to: '/chat' },
      ]
    : []
  return (
    <section aria-label="Your data" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Your data</h2>
      {summary.isPending && <p className="text-sm text-slate-400">Loading…</p>}
      {summary.isError && <ErrorMessage message={getErrorMessage(summary.error, 'Could not load your data')} />}
      {summary.data && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {items.map((item) => (
              <Link key={item.label} to={item.to} className="rounded-xl border border-slate-800 p-3 hover:bg-slate-800/50">
                <dt className="text-xs text-slate-400">{item.label}</dt>
                <dd className="text-xl font-bold tabular-nums text-white">{item.value.toLocaleString('en-US')}</dd>
              </Link>
            ))}
          </dl>
          <p className="text-xs text-slate-500">
            {summary.data.latest_analysis_at
              ? `Latest analysis: ${formatDateTime(summary.data.latest_analysis_at)}.`
              : 'No analyses yet.'}
          </p>
        </>
      )}
    </section>
  )
}

function Password() {
  const { replaceToken } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: ({ access_token }) => {
      replaceToken(access_token)
      setCurrent('')
      setNext('')
      setConfirm('')
    },
  })
  const problem =
    next.length > 0 && next.length < MIN_PASSWORD
      ? `The new password must be at least ${MIN_PASSWORD} characters long.`
      : confirm.length > 0 && confirm !== next
        ? 'The new passwords do not match.'
        : next.length > 0 && next === current
          ? 'Choose a password different from the current one.'
          : null
  const ready = current.length > 0 && next.length >= MIN_PASSWORD && confirm === next && problem === null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ready && !change.isPending) change.mutate()
  }

  return (
    <Card title="Password" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
      <form onSubmit={submit} aria-label="Change password" className="grid gap-3 sm:max-w-md">
        <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} />
        <PasswordField label="New password" autoComplete="new-password" value={next} onChange={setNext} />
        <PasswordField label="Confirm the new password" autoComplete="new-password" value={confirm} onChange={setConfirm} />
        <ErrorMessage message={problem} />
        <ErrorMessage message={change.isError ? getErrorMessage(change.error, 'Could not change the password') : null} />
        {change.isSuccess && (
          <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            Password changed. Every other session was signed out; this one continues.
          </p>
        )}
        <div>
          <button type="submit" disabled={!ready || change.isPending} className={PRIMARY}>
            {change.isPending ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </Card>
  )
}

function Preferences() {
  const status = useChatStatus()
  return (
    <Card title="Preferences" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}>
      <dl className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <dt className="font-medium text-slate-200">Health score weights</dt>
            <dd className="text-xs text-slate-400">How much each dimension counts in your scores and reports.</dd>
          </div>
          <Link to="/health-score#weights" className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
            Change the weights
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <dt className="font-medium text-slate-200">AI chat and explanations</dt>
            <dd className="text-xs text-slate-400">Set on the server with ANTHROPIC_API_KEY or GEMINI_API_KEY; keys are never sent to the browser.</dd>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs ${status.data?.configured ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-300'}`}>
            {status.isPending ? 'Checking…' : status.isError ? 'Unknown' : status.data.configured ? 'Available' : 'Not configured'}
          </span>
        </div>
      </dl>
    </Card>
  )
}

function DeleteAccount() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [understood, setUnderstood] = useState(false)
  const remove = useMutation({
    mutationFn: () => deleteAccount(password),
    onSuccess: () => {
      logout()
      navigate('/login', { replace: true, state: { notice: 'Your account and all its data were deleted.' } })
    },
  })
  return (
    <Card title="Delete account" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />} tone="danger">
      <p className="text-sm text-slate-300">
        Permanently deletes your account with every project, repository, analysis, PDF report
        and conversation in it. This cannot be undone.
      </p>
      <form
        aria-label="Delete account"
        className="grid gap-3 sm:max-w-md"
        onSubmit={(event) => {
          event.preventDefault()
          if (password && understood && !remove.isPending) remove.mutate()
        }}
      >
        <PasswordField label="Your password" autoComplete="current-password" value={password} onChange={setPassword} />
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} className="mt-0.5" />
          I understand that my account and all its data will be deleted permanently.
        </label>
        <ErrorMessage message={remove.isError ? getErrorMessage(remove.error, 'Could not delete the account') : null} />
        <div>
          <button
            type="submit"
            disabled={!password || !understood || remove.isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {remove.isPending ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </form>
    </Card>
  )
}

export function SettingsPage() {
  const { user } = useAuth()
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-600/20 via-indigo-600/15 to-fuchsia-500/10 p-8">
        <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">Your profile, password, preferences and data.</p>
      </div>
      {user && <Profile user={user} />}
      <Summary />
      <Password />
      <Preferences />
      <DeleteAccount />
    </div>
  )
}
