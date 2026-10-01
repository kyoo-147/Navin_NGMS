import { NavinContractValidationError, assertValid } from '@navin/contracts'

import { ActionCoreError } from './errors.js'

export type ContractSchema = Parameters<typeof assertValid>[0]

/**
 * Validates a value against a frozen contract schema and normalises failures to
 * ActionCoreError so callers only ever deal with one error type.
 */
export function assertContract(schema: ContractSchema, value: unknown, context: string): void {
  try {
    assertValid(schema, value)
  } catch (error) {
    if (error instanceof NavinContractValidationError) {
      throw new ActionCoreError('VALIDATION_FAILED', `${context}: ${error.message}`, {
        details: { errors: error.errors },
      })
    }
    throw error
  }
}
