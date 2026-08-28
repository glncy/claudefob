import { describe, expect, test } from 'bun:test'
import { chooseLinuxMethod, describeLinuxMethod, linuxBackend } from '../src/auth/linux.ts'
import { AuthUnavailableError } from '../src/auth/types.ts'

const all = () => true
const none = () => false
const only = (name: string) => (bin: string) => bin === name

describe('chooseLinuxMethod', () => {
  test('prefers pkexec in a graphical session, where a polkit agent exists', () => {
    expect(chooseLinuxMethod({ DISPLAY: ':0' } as NodeJS.ProcessEnv, all)).toBe('pkexec')
    expect(chooseLinuxMethod({ WAYLAND_DISPLAY: 'wayland-0' } as NodeJS.ProcessEnv, all)).toBe('pkexec')
  })

  test('uses sudo on a headless box, where pkexec has no agent to ask', () => {
    // Reported in the wild: over SSH, pkexec fails instantly and `show` looked like it had been
    // cancelled when in fact nothing could prompt.
    expect(chooseLinuxMethod({} as NodeJS.ProcessEnv, all)).toBe('sudo')
  })

  test('falls back to pkexec when sudo is absent', () => {
    expect(chooseLinuxMethod({} as NodeJS.ProcessEnv, only('pkexec'))).toBe('pkexec')
  })

  test('reports none when neither is installed', () => {
    expect(chooseLinuxMethod({} as NodeJS.ProcessEnv, none)).toBe('none')
  })
})

describe('linuxBackend', () => {
  test('sudo runs with -k so a cached timestamp never skips the prompt', async () => {
    const calls: [string, string[]][] = []
    const b = linuxBackend(
      'sudo',
      (bin, args) => {
        calls.push([bin, args])
        return { status: 0 }
      },
      () => true,
    )
    expect(await b.challenge()).toBe(true)
    expect(calls).toEqual([['sudo', ['-k', '-v']]])
  })

  test('a non-zero exit is a refusal, not an error', async () => {
    const b = linuxBackend('sudo', () => ({ status: 1 }), () => true)
    expect(await b.challenge()).toBe(false)
  })

  test('none explains there is nothing to authenticate with, and how to read the keystore', async () => {
    const b = linuxBackend('none')
    await expect(b.challenge()).rejects.toThrow(AuthUnavailableError)
    await expect(b.challenge()).rejects.toThrow(/secret-tool lookup/)
  })

  test('a missing binary is reported as unavailable, not as a refusal', async () => {
    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const b = linuxBackend('sudo', () => ({ status: null, error: err }), () => true)
    await expect(b.challenge()).rejects.toThrow(AuthUnavailableError)
  })

  test('describe names the mechanism actually chosen', () => {
    expect(describeLinuxMethod('sudo')).toContain('sudo')
    expect(describeLinuxMethod('pkexec')).toContain('polkit')
  })
})

describe('sudo needs a terminal', () => {
  test('a non-TTY stdin is reported as unavailable, not as a refused password', async () => {
    const b = linuxBackend('sudo', () => ({ status: 0 }), () => false)
    await expect(b.challenge()).rejects.toThrow(/interactive terminal/)
  })

  test('a TTY proceeds to the prompt', async () => {
    const b = linuxBackend('sudo', () => ({ status: 0 }), () => true)
    expect(await b.challenge()).toBe(true)
  })
})
