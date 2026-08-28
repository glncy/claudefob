import { describe, expect, test } from 'bun:test'
import { keyringPersistence, ephemeralKeyringWarning } from '../src/keyring-persistence.ts'

const noKwallet = (p: string) => p.includes('kwalletd') === false

describe('keyringPersistence', () => {
  test('is unknown off Linux, where the keystore is always persistent', () => {
    expect(keyringPersistence('darwin')).toBe('unknown')
    expect(keyringPersistence('win32')).toBe('unknown')
  })

  test('ephemeral when the keyrings directory does not exist', () => {
    const p = keyringPersistence('linux', '/home/u', () => {
      throw new Error('ENOENT')
    }, () => false)
    expect(p).toBe('ephemeral')
  })

  test('ephemeral when only a session keyring is present', () => {
    // This is the headless-Ubuntu case: writes succeed, everything is lost on reboot.
    expect(keyringPersistence('linux', '/home/u', () => ['Session.keyring'], noKwallet)).toBe('ephemeral')
    expect(keyringPersistence('linux', '/home/u', () => ['session.keyring'], noKwallet)).toBe('ephemeral')
  })

  test('ephemeral when the directory is empty', () => {
    expect(keyringPersistence('linux', '/home/u', () => [], noKwallet)).toBe('ephemeral')
  })

  test('persistent when a login keyring exists', () => {
    expect(keyringPersistence('linux', '/home/u', () => ['login.keyring'], noKwallet)).toBe('persistent')
    expect(keyringPersistence('linux', '/home/u', () => ['Default_keyring.keyring'], noKwallet)).toBe('persistent')
  })

  test('persistent when KWallet is in use, whatever gnome-keyring has', () => {
    expect(keyringPersistence('linux', '/home/u', () => [], (p) => p.includes('kwalletd'))).toBe('persistent')
  })

  test('ignores non-keyring files in the directory', () => {
    expect(keyringPersistence('linux', '/home/u', () => ['user.keystore', 'notes.txt'], noKwallet)).toBe('ephemeral')
  })
})

describe('ephemeralKeyringWarning', () => {
  test('names the cause and the Ubuntu fix', () => {
    const w = ephemeralKeyringWarning()
    expect(w).toContain('lives in memory')
    expect(w).toContain('libpam-gnome-keyring')
    expect(w).toContain('gnome-keyring-daemon --unlock')
    expect(w).toContain('ls -la ~/.local/share/keyrings/')
  })
})
