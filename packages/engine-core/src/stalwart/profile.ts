export interface StalwartMethodMap {
  domainQuery: string
  domainGet: string
  domainSet: string
  accountQuery: string
  accountGet: string
  accountSet: string
  aliasQuery: string
  aliasGet: string
  aliasSet: string
}

export interface StalwartProtocolProfile {
  apiPath: string
  healthPath: string
  livenessPath: string
  versionPath: string
  capabilities: string[]
  methods: StalwartMethodMap
}

export const DEFAULT_STALWART_PROFILE: StalwartProtocolProfile = {
  apiPath: '/api',
  healthPath: '/healthz/ready',
  livenessPath: '/healthz/live',
  versionPath: '/api/version',
  capabilities: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
  methods: {
    domainQuery: 'x:Domain/query',
    domainGet: 'x:Domain/get',
    domainSet: 'x:Domain/set',
    accountQuery: 'x:Account/query',
    accountGet: 'x:Account/get',
    accountSet: 'x:Account/set',
    aliasQuery: 'x:Alias/query',
    aliasGet: 'x:Alias/get',
    aliasSet: 'x:Alias/set',
  },
}
