export const API_BASE_PATH = '/api/v1'

function segment(value: string): string {
  return encodeURIComponent(value)
}

export const routes = {
  health: '/health',
  auth: {
    session: '/auth/session',
    login: '/auth/login',
  },
  mail: {
    auth: {
      login: '/mail/auth/login',
      session: '/mail/auth/session',
      logout: '/mail/auth/logout',
    },
    session: '/mail/session',
    mailboxes: '/mail/mailboxes',
    message: (messageId: string) => `/mail/messages/${segment(messageId)}`,
    thread: (threadId: string) => `/mail/threads/${segment(threadId)}`,
    query: '/mail/query',
    mutations: '/mail/mutations',
    submissions: '/mail/submissions',
    events: '/mail/events',
  },
  setup: {
    sessions: '/setup/sessions',
    session: (sessionId: string) => `/setup/sessions/${segment(sessionId)}`,
    resume: (sessionId: string) => `/setup/sessions/${segment(sessionId)}/resume`,
  },
  control: {
    action: (actionId: string) => `/control/actions/${segment(actionId)}`,
    job: (jobId: string) => `/control/jobs/${segment(jobId)}`,
    cancelJob: (jobId: string) => `/control/jobs/${segment(jobId)}/cancel`,
    audit: '/control/audit',
    evidence: (evidenceId: string) => `/control/evidence/${segment(evidenceId)}`,
  },
  events: '/events',
} as const
