import { createRequire } from 'node:module'
import fs from 'node:fs'

const requireFromHere = createRequire(import.meta.url)

export const SERVICE = 'claudefob'

export interface Keystore {
  get(name: string): string | null
  set(name: string, secret: string): void
  delete(name: string): boolean
}

export class KeystoreUnavailableError extends Error {
  cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.cause = cause
  }
}

declare const __CLAUDEFOB_TEST__: boolean | undefined

function isTestBuild(): boolean {
  try {
    return typeof __CLAUDEFOB_TEST__ !== 'undefined' && __CLAUDEFOB_TEST__ === true
  } catch {
    return false
  }
}

// The underlying napi-rs/keyring crate reports "no such entry" as an Error whose message
// names the condition (Rust's keyring crate Display for Error::NoEntry is "No matching entry
// found in secure storage"). Any other failure (locked keystore, dead D-Bus/Secret Service,
// access denied, ambiguous entry) must NOT be treated as "missing" — it must surface as
// KeystoreUnavailableError so callers can report an accurate error instead of silently
// treating a transient outage as a missing secret.
export function isNoEntryError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  // Linux Secret Service phrases a missing secret as "no result found"; macOS/Windows use
  // wording containing "no ... entry". Both mean "this secret does not exist", which is distinct
  // from an unreachable or locked keystore.
  return /no[\s\S]{0,40}entry/i.test(msg) || /no\s+result\s+found/i.test(msg)
}

export function realKeystore(): Keystore {
  return {
    get(name: string): string | null {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Entry } = requireFromHere('@napi-rs/keyring')
        const entry = new Entry(SERVICE, name)
        try {
          return entry.getPassword()
        } catch (e) {
          if (isNoEntryError(e)) return null
          throw new KeystoreUnavailableError('The OS keystore is unavailable.', e)
        }
      } catch (e) {
        if (e instanceof KeystoreUnavailableError) throw e
        throw new KeystoreUnavailableError('The OS keystore is unavailable.', e)
      }
    },
    set(name: string, secret: string): void {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Entry } = requireFromHere('@napi-rs/keyring')
        const entry = new Entry(SERVICE, name)
        entry.setPassword(secret)
      } catch (e) {
        throw new KeystoreUnavailableError('The OS keystore is unavailable.', e)
      }
    },
    delete(name: string): boolean {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Entry } = requireFromHere('@napi-rs/keyring')
        const entry = new Entry(SERVICE, name)
        try {
          return entry.deletePassword()
        } catch {
          return false
        }
      } catch (e) {
        throw new KeystoreUnavailableError('The OS keystore is unavailable.', e)
      }
    },
  }
}

function fakeFileKeystore(filePath: string): Keystore {
  function load(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch {
      return {}
    }
  }
  function save(data: Record<string, string>) {
    fs.writeFileSync(filePath, JSON.stringify(data))
  }
  return {
    get(name) {
      const data = load()
      return Object.prototype.hasOwnProperty.call(data, name) ? data[name]! : null
    },
    set(name, secret) {
      const data = load()
      data[name] = secret
      save(data)
    },
    delete(name) {
      const data = load()
      if (!Object.prototype.hasOwnProperty.call(data, name)) return false
      delete data[name]
      save(data)
      return true
    },
  }
}

let injected: Keystore | null = null

export function __setKeystoreForTests(k: Keystore | null): void {
  injected = k
}

export function getKeystore(): Keystore {
  if (injected) return injected
  if (isTestBuild()) {
    const fakePath = process.env.CLAUDEFOB_FAKE_KEYSTORE
    if (fakePath === '__THROW__') {
      return {
        get(): string | null {
          throw new KeystoreUnavailableError('fake keystore forced failure')
        },
        set(): void {
          throw new KeystoreUnavailableError('fake keystore forced failure')
        },
        delete(): boolean {
          throw new KeystoreUnavailableError('fake keystore forced failure')
        },
      }
    }
    if (fakePath) return fakeFileKeystore(fakePath)
  }
  return realKeystore()
}
