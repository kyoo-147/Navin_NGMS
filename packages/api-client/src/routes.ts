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
    organization: {
      planAlias: '/control/organization/aliases/plan',
      aliases: '/control/organization/aliases',
      aliasAction: (actionId: string) => `/control/organization/actions/${segment(actionId)}`,
      rollbackAlias: (actionId: string) =>
        `/control/organization/actions/${segment(actionId)}/rollback`,
      planDomain: '/control/organization/domains/plan',
      domains: '/control/organization/domains',
      domainAction: (actionId: string) =>
        `/control/organization/domains/actions/${segment(actionId)}`,
      rollbackDomain: (actionId: string) =>
        `/control/organization/domains/actions/${segment(actionId)}/rollback`,
      planMailbox: '/control/organization/mailboxes/plan',
      mailboxes: '/control/organization/mailboxes',
      mailboxAction: (actionId: string) =>
        `/control/organization/mailboxes/actions/${segment(actionId)}`,
      rollbackMailbox: (actionId: string) =>
        `/control/organization/mailboxes/actions/${segment(actionId)}/rollback`,
    },
  },
  events: '/events',
} as const
