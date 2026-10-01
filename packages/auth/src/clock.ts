/** Injectable time source. All auth decisions read time through this interface. */
export interface Clock {
  now(): Date
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}

/** Deterministic clock for tests and reproducible evidence. */
export class FixedClock implements Clock {
  private current: number

  constructor(initial: Date | string | number = new Date()) {
    this.current = new Date(initial).getTime()
  }

  now(): Date {
    return new Date(this.current)
  }

  set(value: Date | string | number): void {
    this.current = new Date(value).getTime()
  }

  advance(milliseconds: number): void {
    this.current += milliseconds
  }
}
