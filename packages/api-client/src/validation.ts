import type { Static, TSchema } from '@sinclair/typebox'
import { validate } from '@navin/contracts'
import { ApiClientError, ApiValidationError, type ApiErrorContext } from './errors.js'

export interface ValidationContext {
  surface?: ApiErrorContext['surface']
  correlationId?: string
  requestId?: string
}

export function parseJsonBody(text: string, context: ValidationContext): unknown {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    throw new ApiValidationError(
      'RESPONSE_VALIDATION_FAILED',
      'Response body is not valid JSON',
      [],
      { ...context, cause: error },
    )
  }
}

export function validateRequestValue<T extends TSchema>(
  schema: T,
  value: unknown,
  context: ValidationContext,
): Static<T> {
  const result = validate(schema, value)
  if (!result.success) {
    throw new ApiValidationError(
      'REQUEST_VALIDATION_FAILED',
      'Request payload failed contract validation',
      result.errors,
      context,
    )
  }
  return result.data
}

export function validateResponseValue<T extends TSchema>(
  schema: T,
  text: string,
  context: ValidationContext,
): Static<T> {
  const value = parseJsonBody(text, context)
  const result = validate(schema, value)
  if (!result.success) {
    throw new ApiValidationError(
      'RESPONSE_VALIDATION_FAILED',
      'Response payload failed contract validation',
      result.errors,
      context,
    )
  }
  return result.data
}

export function ensureNotEmptyText(text: string, context: ValidationContext): void {
  if (text.trim().length === 0) {
    throw new ApiClientError({
      code: 'SSE_ERROR',
      message: 'Expected a response body but none was returned',
      surface: context.surface,
      correlationId: context.correlationId,
      requestId: context.requestId,
    })
  }
}
