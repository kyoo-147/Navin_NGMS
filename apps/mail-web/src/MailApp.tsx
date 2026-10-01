import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createIdempotencyKey,
  type MailApiClient,
  type MailAuthSession,
  type MailMailbox,
  type MailSessionInfo,
  type MailSubmissionInput,
} from '@navin/api-client'
import type { AccountId, AliasId, MailboxId, StandardMutationType, UserId } from '@navin/contracts'
import { groupEmailsIntoThreads, htmlToText, parseRecipients, type ThreadGroup } from './threads.js'

export interface MailAppProps {
  /** Builds the Mail client bound to the current (possibly not-yet-signed-in) token. */
  clientFactory: (getToken: () => string | undefined) => MailApiClient
}

type Status = 'loading' | 'idle' | 'ready' | 'error'
type ComposeStatus = 'idle' | 'sending' | 'sent' | 'error'

interface SendResult {
  submissionId: string
  status: string
  submittedAt: string
  idempotencyKey: string
}

/**
 * Minimal, real Navin Mail workspace. It talks only to the navind Mail BFF
 * through the typed API client — no fixture data and no local mock backend.
 * Compose/send uses the server-authoritative sender binding and is disabled
 * (fail closed) when the engine or configuration cannot send.
 */
export const MailApp: React.FC<MailAppProps> = ({ clientFactory }) => {
  const tokenRef = useRef<string | undefined>(undefined)
  const clientRef = useRef<MailApiClient | null>(null)
  if (clientRef.current === null) {
    clientRef.current = clientFactory(() => tokenRef.current)
  }
  const client = clientRef.current

  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [auth, setAuth] = useState<MailAuthSession | null>(null)
  const [engine, setEngine] = useState<MailSessionInfo | null>(null)
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([])
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | undefined>(undefined)
  const [threads, setThreads] = useState<ThreadGroup[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeStatus, setComposeStatus] = useState<ComposeStatus>('idle')
  const [composeError, setComposeError] = useState<string | null>(null)
  const [composeResult, setComposeResult] = useState<SendResult | null>(null)
  const [sendCount, setSendCount] = useState(0)
  const [composeKey, setComposeKey] = useState<string>(() => createIdempotencyKey())
  const lastSentKeyRef = useRef<string | null>(null)

  const accountId = engine?.primaryAccountId ?? engine?.accounts[0]?.accountId ?? undefined
  const primaryAccount = useMemo(() => {
    if (!engine) return undefined
    return (
      engine.accounts.find((account) => account.accountId === engine.primaryAccountId) ??
      engine.accounts[0]
    )
  }, [engine])
  const sender = engine?.sender ?? null

  const composeDisabledReason = useMemo(() => {
    if (!engine) return 'Mail session is not loaded yet.'
    if (!engine.capabilities.submission) return 'This mail engine does not support submission.'
    if (!sender) return 'No sender identity is configured for this deployment.'
    if (!primaryAccount) return 'No mail account is available.'
    if (primaryAccount.isReadOnly) return 'This mail account is read-only.'
    if (!primaryAccount.submissionCapable) return 'This mail account cannot submit mail.'
    return null
  }, [engine, sender, primaryAccount])
  const canSend = composeDisabledReason === null && accountId !== undefined && sender !== null

  const loadThreadsFor = useCallback(
    async (account: string, mailboxId?: string): Promise<void> => {
      const page = await client.query({
        accountId: account as AccountId,
        position: 0,
        limit: 50,
        filter: mailboxId ? { inMailbox: mailboxId as MailboxId } : undefined,
      })
      const messages = await Promise.all(
        page.messageIds.map((messageId) => client.getMessage(account, messageId)),
      )
      setThreads(groupEmailsIntoThreads(messages))
    },
    [client],
  )

  const loadWorkspace = useCallback(
    async (session: MailAuthSession): Promise<void> => {
      setAuth(session)
      const info = await client.engineSession()
      setEngine(info)
      const account = info.primaryAccountId ?? info.accounts[0]?.accountId
      if (!account) {
        setStatus('ready')
        return
      }
      const boxes = await client.listMailboxes(account)
      setMailboxes(boxes)
      const inbox = boxes.find((box) => box.role === 'inbox') ?? boxes[0]
      setSelectedMailboxId(inbox?.id)
      await loadThreadsFor(account, inbox?.id)
      setStatus('ready')
    },
    [client, loadThreadsFor],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const session = await client.session()
        if (!cancelled) await loadWorkspace(session)
      } catch {
        if (!cancelled) setStatus('idle')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, loadWorkspace])

  const handleLogin = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setStatus('loading')
    setError(null)
    try {
      const result = await client.login({ email, password })
      tokenRef.current = result.token
      const session = await client.session()
      await loadWorkspace(session)
    } catch (caught) {
      setError(describeError(caught))
      setStatus('error')
    }
  }

  const handleLogout = async (): Promise<void> => {
    try {
      await client.logout()
    } catch {
      // A failed logout still clears the local session.
    }
    tokenRef.current = undefined
    setAuth(null)
    setEngine(null)
    setMailboxes([])
    setThreads([])
    setSelectedThreadId(undefined)
    setStatus('idle')
  }

  const handleSelectMailbox = async (mailboxId: string): Promise<void> => {
    setSelectedMailboxId(mailboxId)
    if (!accountId) return
    setStatus('loading')
    setError(null)
    try {
      await loadThreadsFor(accountId, mailboxId)
      setStatus('ready')
    } catch (caught) {
      setError(describeError(caught))
      setStatus('error')
    }
  }

  const applyMutation = useCallback(
    async (mutation: StandardMutationType, threadIds: string[]): Promise<void> => {
      if (!accountId || threadIds.length === 0) return
      const targetIds = threadIds.flatMap(
        (threadId) =>
          threads.find((thread) => thread.id === threadId)?.messages.map((message) => message.id) ??
          [],
      )
      if (targetIds.length === 0) return
      try {
        await client.mutate({ accountId: accountId as AccountId, mutation, targetIds })
        await loadThreadsFor(accountId, selectedMailboxId)
      } catch (caught) {
        setError(describeError(caught))
      }
    },
    [accountId, client, loadThreadsFor, selectedMailboxId, threads],
  )

  const changeField = (setter: (value: string) => void, value: string): void => {
    setter(value)
    setComposeError(null)
    setComposeStatus('idle')
    // A new message needs a fresh idempotency key; retrying the same message
    // keeps the key it was already sent with.
    if (lastSentKeyRef.current === composeKey) {
      setComposeKey(createIdempotencyKey())
      lastSentKeyRef.current = null
    }
  }

  const send = async (): Promise<void> => {
    if (!canSend || !accountId || !sender) return
    const recipients = parseRecipients(composeTo)
    if (recipients.length === 0) {
      setComposeError('At least one valid recipient is required.')
      setComposeStatus('error')
      return
    }
    setComposeStatus('sending')
    setComposeError(null)
    try {
      const input: MailSubmissionInput = {
        accountId: accountId as AccountId,
        senderIdentityId: sender.identityId as AliasId | UserId,
        idempotencyKey: composeKey,
        from: { address: sender.address },
        to: recipients,
        subject: composeSubject,
        bodyText: composeBody,
      }
      const result = await client.submit(input)
      setComposeResult({
        submissionId: result.submissionId,
        status: result.status,
        submittedAt: result.submittedAt,
        idempotencyKey: result.idempotencyKey,
      })
      lastSentKeyRef.current = composeKey
      setSendCount((count) => count + 1)
      setComposeStatus('sent')
    } catch (caught) {
      setComposeError(describeError(caught))
      setComposeStatus('error')
    }
  }

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId),
    [threads, selectedThreadId],
  )

  if (!auth) {
    return (
      <div className="mail-app" data-testid="mail-login">
        <form className="mail-login" onSubmit={handleLogin} aria-label="Sign in to Navin Mail">
          <h1>Navin Mail</h1>
          <p>Sign in to your mailbox.</p>
          {error && (
            <p role="alert" data-testid="mail-login-error">
              {error}
            </p>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={status === 'loading'}>
            {status === 'loading' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="mail-app" data-testid="mail-workspace">
      <header className="mail-header">
        <span className="mail-brand">Navin Mail</span>
        <div className="mail-header-actions">
          {sender && (
            <span data-testid="mail-sender-address" title="Configured sender">
              From: {sender.address}
            </span>
          )}
          <span data-testid="mail-current-user">{auth.email}</span>
          <button type="button" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </header>

      {status === 'loading' && <div data-testid="mail-loading">Loading mail…</div>}
      {error && (
        <p role="alert" data-testid="mail-error">
          {error}
        </p>
      )}

      <div className="mail-columns">
        <MailboxNav
          mailboxes={mailboxes}
          selectedMailboxId={selectedMailboxId}
          onSelect={(mailboxId) => void handleSelectMailbox(mailboxId)}
          onCompose={() => setComposeOpen(true)}
        />

        {composeOpen && (
          <section className="mail-compose" aria-label="Compose message" data-testid="mail-compose">
            <h2>Compose</h2>
            {composeDisabledReason && (
              <p role="note" data-testid="mail-compose-disabled">
                Sending is unavailable: {composeDisabledReason}
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
            >
              <label>
                From
                <input
                  type="text"
                  value={sender?.address ?? ''}
                  readOnly
                  aria-label="From address"
                  data-testid="mail-compose-from"
                />
              </label>
              <label>
                To
                <input
                  type="text"
                  value={composeTo}
                  disabled={!canSend}
                  aria-label="Recipients"
                  data-testid="mail-compose-to"
                  onChange={(event) => changeField(setComposeTo, event.target.value)}
                />
              </label>
              <label>
                Subject
                <input
                  type="text"
                  value={composeSubject}
                  disabled={!canSend}
                  aria-label="Subject"
                  data-testid="mail-compose-subject"
                  onChange={(event) => changeField(setComposeSubject, event.target.value)}
                />
              </label>
              <label>
                Message
                <textarea
                  value={composeBody}
                  disabled={!canSend}
                  aria-label="Message body"
                  data-testid="mail-compose-body"
                  onChange={(event) => changeField(setComposeBody, event.target.value)}
                />
              </label>
              <div className="mail-compose-actions">
                <button
                  type="submit"
                  disabled={!canSend || composeStatus === 'sending'}
                  data-testid="mail-compose-send"
                >
                  {composeStatus === 'sending' ? 'Sending…' : 'Send'}
                </button>
                {composeResult && composeStatus === 'sent' && (
                  <button
                    type="button"
                    onClick={() => void send()}
                    data-testid="mail-compose-resend"
                    title="Retry with the same idempotency key"
                  >
                    Send again (same key)
                  </button>
                )}
              </div>
            </form>

            {composeError && (
              <p role="alert" data-testid="mail-compose-error">
                {composeError}
              </p>
            )}
            {composeResult && (
              <p data-testid="mail-send-result">
                <span data-testid="mail-send-submission-id">{composeResult.submissionId}</span>{' '}
                <span data-testid="mail-send-status">{composeResult.status}</span>{' '}
                <span data-testid="mail-send-count">{sendCount}</span>
              </p>
            )}
          </section>
        )}

        <div className="mail-list-column">
          <ThreadList
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelect={(threadId) => setSelectedThreadId(threadId)}
            onStar={(threadId, starred) =>
              void applyMutation(starred ? 'star' : 'unstar', [threadId])
            }
            onArchive={(threadId) => void applyMutation('archive', [threadId])}
            onTrash={(threadId) => void applyMutation('trash', [threadId])}
            onMarkRead={(threadId, read) =>
              void applyMutation(read ? 'mark_read' : 'mark_unread', [threadId])
            }
          />

          {selectedThread && (
            <ThreadReader
              thread={selectedThread}
              onBack={() => setSelectedThreadId(undefined)}
              onTrash={(threadId) => void applyMutation('trash', [threadId])}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function MailboxNav({
  mailboxes,
  selectedMailboxId,
  onSelect,
  onCompose,
}: {
  mailboxes: MailMailbox[]
  selectedMailboxId: string | undefined
  onSelect: (mailboxId: string) => void
  onCompose: () => void
}): React.ReactElement {
  return (
    <nav className="mail-nav" aria-label="Mailboxes" data-testid="mail-mailboxes">
      <button type="button" className="mail-compose-btn" onClick={onCompose}>
        Compose
      </button>
      <ul>
        {mailboxes.map((mailbox) => (
          <li key={mailbox.id}>
            <button
              type="button"
              className={mailbox.id === selectedMailboxId ? 'is-active' : ''}
              aria-current={mailbox.id === selectedMailboxId ? 'page' : undefined}
              onClick={() => onSelect(mailbox.id)}
            >
              <span>{mailbox.name}</span>
              {mailbox.unreadEmails > 0 && (
                <span className="mail-nav-badge">{mailbox.unreadEmails}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function ThreadList({
  threads,
  selectedThreadId,
  onSelect,
  onStar,
  onArchive,
  onTrash,
  onMarkRead,
}: {
  threads: ThreadGroup[]
  selectedThreadId: string | undefined
  onSelect: (threadId: string) => void
  onStar: (threadId: string, starred: boolean) => void
  onArchive: (threadId: string) => void
  onTrash: (threadId: string) => void
  onMarkRead: (threadId: string, read: boolean) => void
}): React.ReactElement {
  if (threads.length === 0) {
    return <div className="mail-empty">No messages found.</div>
  }
  return (
    <ul className="mail-thread-list" aria-label="Threads" data-testid="mail-thread-list">
      {threads.map((thread) => (
        <li
          key={thread.id}
          className={`mail-thread-row ${thread.unreadCount > 0 ? 'is-unread' : ''} ${
            thread.id === selectedThreadId ? 'is-active' : ''
          }`}
        >
          <button
            type="button"
            className="mail-thread-open"
            aria-current={thread.id === selectedThreadId ? 'true' : undefined}
            onClick={() => onSelect(thread.id)}
          >
            <span className="mail-thread-participants">{thread.participants}</span>
            {thread.messageCount > 1 && (
              <span className="mail-thread-count">{thread.messageCount}</span>
            )}
            <span className="mail-thread-subject">{thread.subject}</span>
            <span className="mail-thread-snippet">{thread.snippet}</span>
          </button>
          <span className="mail-thread-actions">
            <button
              type="button"
              aria-label={thread.isStarred ? 'Unstar thread' : 'Star thread'}
              onClick={() => onStar(thread.id, !thread.isStarred)}
            >
              {thread.isStarred ? '★' : '☆'}
            </button>
            <button type="button" aria-label="Archive thread" onClick={() => onArchive(thread.id)}>
              Archive
            </button>
            <button
              type="button"
              aria-label="Toggle read state"
              onClick={() => onMarkRead(thread.id, thread.unreadCount > 0)}
            >
              {thread.unreadCount > 0 ? 'Mark read' : 'Mark unread'}
            </button>
            <button type="button" aria-label="Delete thread" onClick={() => onTrash(thread.id)}>
              Trash
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}

function ThreadReader({
  thread,
  onBack,
  onTrash,
}: {
  thread: ThreadGroup
  onBack: () => void
  onTrash: (threadId: string) => void
}): React.ReactElement {
  return (
    <section
      className="mail-reader"
      aria-label={`Thread: ${thread.subject}`}
      data-testid="mail-reader"
    >
      <div className="mail-reader-header">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h2>{thread.subject}</h2>
        <button type="button" onClick={() => onTrash(thread.id)}>
          Delete
        </button>
      </div>
      {thread.messages.map((message) => {
        const author = message.from[0]
        return (
          <article key={message.id} className="mail-message">
            <header>
              <strong>{author?.name ?? author?.address ?? 'Unknown sender'}</strong>
              <span>{new Date(message.receivedAt).toLocaleString()}</span>
            </header>
            <pre className="mail-message-body">
              {message.bodyText ?? (message.bodyHtml ? htmlToText(message.bodyHtml) : '')}
            </pre>
            {message.attachments.length > 0 && (
              <ul className="mail-attachments">
                {message.attachments.map((attachment) => (
                  <li key={`${message.id}-${attachment.filename}`}>
                    {attachment.filename} ({(attachment.size / 1024).toFixed(0)} KB)
                  </li>
                ))}
              </ul>
            )}
          </article>
        )
      })}
    </section>
  )
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown }
    if (typeof record.message === 'string' && record.message.length > 0) {
      return typeof record.code === 'string' ? `${record.code}: ${record.message}` : record.message
    }
  }
  return error instanceof Error ? error.message : 'Request failed'
}
