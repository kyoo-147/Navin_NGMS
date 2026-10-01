import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    /** Correlation id for this request, echoed in headers and logs. */
    correlationId: string
    /** Epoch milliseconds when the request entered the server. */
    startTime: number
  }
}
