import { err } from './out.ts'

export class UsageError extends Error {
  readonly code = 2
}

export class AuthError extends Error {
  readonly code = 3
}

export class KeystoreError extends Error {
  readonly code = 4
}

export function reportAndExit(e: unknown): never {
  if (e instanceof UsageError || e instanceof AuthError || e instanceof KeystoreError) {
    err(`Error: ${e.message}`)
    process.exit(e.code)
  }
  if (e instanceof Error) {
    err(`Error: ${e.message}`)
    process.exit(1)
  }
  err(`Error: ${String(e)}`)
  process.exit(1)
}
