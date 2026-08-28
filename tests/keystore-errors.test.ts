import { describe, expect, test } from 'bun:test'
import { isNoEntryError, keystoreHint } from '../src/keystore.ts'

describe('isNoEntryError distinguishes "no such secret" from other keystore failures', () => {
  test('matches the underlying keyring crate\'s NoEntry message', () => {
    expect(isNoEntryError(new Error('No matching entry found in secure storage'))).toBe(true)
  })

  test('does not match a locked/unreachable keystore error', () => {
    expect(isNoEntryError(new Error('The specified item could not be found in the keychain.'))).toBe(false)
    expect(isNoEntryError(new Error('org.freedesktop.DBus.Error.ServiceUnknown'))).toBe(false)
    expect(isNoEntryError(new Error('Access denied'))).toBe(false)
    expect(isNoEntryError(new Error('Ambiguous'))).toBe(false)
  })

  test('matches the Linux Secret Service phrasing for a missing secret', () => {
    // Regression: this message was previously classified as an unavailable keystore, which made
    // a missing secret on Linux exit 4 instead of being reported as absent.
    expect(isNoEntryError(new Error("Couldn't access platform storage: Secret Service: no result found"))).toBe(true)
  })

  test('non-Error values never count as NoEntry', () => {
    expect(isNoEntryError('random string')).toBe(false)
    expect(isNoEntryError(undefined)).toBe(false)
  })
})

describe('keystoreHint names an actionable fix on every platform (SPEC §7, ADDENDUM A5)', () => {
  test('linux hint names a Secret Service provider and how to start it', () => {
    const h = keystoreHint('linux')
    expect(h).toContain('gnome-keyring')
    expect(h).toContain('dbus-launch')
  })
  test('darwin hint names the login keychain', () => {
    expect(keystoreHint('darwin')).toContain('unlock-keychain')
  })
  test('win32 hint names Credential Manager', () => {
    expect(keystoreHint('win32')).toContain('Credential Manager')
  })
  test('every platform hint is more than a bare failure statement', () => {
    for (const p of ['linux', 'darwin', 'win32'] as NodeJS.Platform[]) {
      expect(keystoreHint(p).length).toBeGreaterThan(80)
    }
  })
})
