import type { Keystore } from '../../src/keystore.ts'
import { KeystoreUnavailableError } from '../../src/keystore.ts'

export function mapKeystore(initial: Record<string, string> = {}): Keystore {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    get(name) {
      return map.has(name) ? map.get(name)! : null
    },
    set(name, secret) {
      map.set(name, secret)
    },
    delete(name) {
      return map.delete(name)
    },
  }
}

export function throwingKeystore(message = 'fake keystore unavailable'): Keystore {
  return {
    get(): string | null {
      throw new KeystoreUnavailableError(message)
    },
    set(): void {
      throw new KeystoreUnavailableError(message)
    },
    delete(): boolean {
      throw new KeystoreUnavailableError(message)
    },
  }
}

export function emptyKeystore(): Keystore {
  return mapKeystore({})
}
