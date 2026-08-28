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

  test('non-Error values never count as NoEntry', () => {
    expect(isNoEntryError('random string')).toBe(false)
    expect(isNoEntryError(undefined)).toBe(false)
  })
})
