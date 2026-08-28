import { describe, test, expect } from 'bun:test'
import { isNewer, shouldCheck, isStale, detectInstallMethod, updateCommandFor } from '../src/update-check.ts'

describe('isNewer', () => {
  test('detects a newer patch, minor and major', () => {
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
  })
  test('is false for equal or older', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
  })
  test('never offers a prerelease as an update', () => {
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(false)
  })
  test('is false for unparseable input', () => {
    expect(isNewer('garbage', '0.1.0')).toBe(false)
  })
  test('compares numerically, not lexically', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
  })
})

describe('shouldCheck', () => {
  const tty = { ...process.stderr, isTTY: true }
  test('never runs for export — that is the shell startup path', () => {
    expect(shouldCheck({ command: 'export', json: false }, {} as NodeJS.ProcessEnv)).toBe(false)
  })
  test('never runs in json mode', () => {
    expect(shouldCheck({ command: 'list', json: true }, {} as NodeJS.ProcessEnv)).toBe(false)
  })
  test('is disabled by CI, NO_UPDATE_NOTIFIER and CLAUDEFOB_NO_UPDATE_CHECK', () => {
    for (const env of [{ CI: '1' }, { NO_UPDATE_NOTIFIER: '1' }, { CLAUDEFOB_NO_UPDATE_CHECK: '1' }]) {
      expect(shouldCheck({ command: 'list', json: false }, env as NodeJS.ProcessEnv)).toBe(false)
    }
  })
  void tty
})

describe('isStale', () => {
  const now = Date.parse('2026-08-28T00:00:00.000Z')
  test('a missing cache is stale', () => expect(isStale(null, now)).toBe(true))
  test('a cache older than 24h is stale', () => {
    expect(isStale({ lastCheck: '2026-08-26T00:00:00.000Z', latest: '0.1.0' }, now)).toBe(true)
  })
  test('a fresh cache is not stale', () => {
    expect(isStale({ lastCheck: '2026-08-27T23:00:00.000Z', latest: '0.1.0' }, now)).toBe(false)
  })
  test('an unparseable timestamp is treated as stale', () => {
    expect(isStale({ lastCheck: 'not-a-date', latest: '0.1.0' }, now)).toBe(true)
  })
})

describe('detectInstallMethod', () => {
  test('recognises package managers from the install path', () => {
    expect(detectInstallMethod('/opt/homebrew/Cellar/claudefob/0.1.0/bin/claudefob')).toBe('homebrew')
    expect(detectInstallMethod('/Users/x/.bun/install/global/node_modules/claudefob/dist/cli.js')).toBe('bun')
    expect(detectInstallMethod('/usr/lib/node_modules/claudefob/dist/cli.js')).toBe('npm')
  })
  test('is unknown for an unrecognised path', () => {
    expect(detectInstallMethod('/tmp/whatever/cli.js')).toBe('unknown')
  })
  test('unknown falls back to the npm command', () => {
    expect(updateCommandFor('unknown')).toBe('npm install -g claudefob@latest')
  })
})
