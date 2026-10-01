import { TypeCompiler, type TypeCheck } from '@sinclair/typebox/compiler'
import { Value } from '@sinclair/typebox/value'
import { type TSchema, type Static } from '@sinclair/typebox'

export interface ValidationSuccess<T> {
  success: true
  data: T
}

export interface ValidationErrorItem {
  path: string
  message: string
  type?: number
  value?: unknown
}

export interface ValidationFailure {
  success: false
  errors: ValidationErrorItem[]
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

export class NavinContractValidationError extends Error {
  readonly errors: ValidationErrorItem[]

  constructor(message: string, errors: ValidationErrorItem[]) {
    super(message)
    this.name = 'NavinContractValidationError'
    this.errors = errors
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

const compilerCache = new WeakMap<TSchema, TypeCheck<TSchema>>()

export function getValidator<T extends TSchema>(schema: T): TypeCheck<T> {
  let validator = compilerCache.get(schema) as TypeCheck<T> | undefined
  if (!validator) {
    validator = TypeCompiler.Compile(schema)
    compilerCache.set(schema, validator)
  }
  return validator
}

export function isValid<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  return getValidator(schema).Check(value)
}

export function validate<T extends TSchema>(
  schema: T,
  value: unknown,
): ValidationResult<Static<T>> {
  const validator = getValidator(schema)
  if (validator.Check(value)) {
    return { success: true, data: value as Static<T> }
  }
  const errors: ValidationErrorItem[] = []
  for (const err of validator.Errors(value)) {
    errors.push({
      path: err.path,
      message: err.message,
      type: err.type,
      value: err.value,
    })
  }
  return { success: false, errors }
}

export function assertValid<T extends TSchema>(
  schema: T,
  value: unknown,
): asserts value is Static<T> {
  const res = validate(schema, value)
  if (!res.success) {
    const errorDetails = res.errors.map((e) => `${e.path}: ${e.message}`).join(', ')
    throw new NavinContractValidationError(
      `Contract validation failed: ${errorDetails}`,
      res.errors,
    )
  }
}

/**
 * Returns a cloned value with schema default annotations applied where fields are omitted.
 */
export function applyDefaults<T extends TSchema>(schema: T, value: unknown): Static<T> {
  const cloned = Value.Clone(value)
  Value.Default(schema, cloned)
  return cloned as Static<T>
}

/**
 * Applies schema default values and then validates against the schema.
 */
export function validateWithDefaults<T extends TSchema>(
  schema: T,
  value: unknown,
): ValidationResult<Static<T>> {
  const withDefaults = applyDefaults(schema, value)
  const result = validate(schema, withDefaults)
  if (result.success) {
    return { success: true, data: withDefaults }
  }
  return result
}

/**
 * Asserts that the value (after applying schema defaults) matches the schema.
 */
export function assertValidWithDefaults<T extends TSchema>(
  schema: T,
  value: unknown,
): asserts value is Static<T> {
  const res = validateWithDefaults(schema, value)
  if (!res.success) {
    const errorDetails = res.errors.map((e) => `${e.path}: ${e.message}`).join(', ')
    throw new NavinContractValidationError(
      `Contract validation with defaults failed: ${errorDetails}`,
      res.errors,
    )
  }
}
