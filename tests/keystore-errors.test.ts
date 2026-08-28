import { describe, expect, test } from 'bun:test'
import { isNoEntryError } from '../src/keystore.ts'

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
