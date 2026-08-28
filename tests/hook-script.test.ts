import { describe, expect, test } from 'bun:test'
import { codegenFor, type ShellDialect } from '../src/shell/index.ts'
import { hookScriptPath } from '../src/paths.ts'
import path from 'node:path'

const DIALECTS: ShellDialect[] = ['posix', 'fish', 'powershell']

describe('hookScriptPath', () => {
  test('uses the right extension per dialect', () => {
    // Built with path.join so the expectation holds on both separators — a hardcoded '/' fails
    // on Windows, where join yields backslashes.
    const env = { XDG_CONFIG_HOME: '/cfg' } as NodeJS.ProcessEnv
    for (const [dialect, file] of [['posix', 'hook.sh'], ['fish', 'hook.fish'], ['powershell', 'hook.ps1']] as const) {
      expect(hookScriptPath(dialect, env, 'linux')).toBe(path.join('/cfg', 'claudefob', file))
    }
  })

  test('lives in claudefob\'s own config dir, never a user dotfile', () => {
    const p = hookScriptPath('posix', { XDG_CONFIG_HOME: '/cfg' } as NodeJS.ProcessEnv, 'linux')
    expect(p).toContain(path.join('claudefob', 'hook.sh'))
  })
})

describe('sourceBlock', () => {
  test('every dialect can emit a one-line source block', () => {
    for (const d of DIALECTS) {
      expect(typeof codegenFor(d).sourceBlock).toBe('function')
    }
  })

  test('the block is three lines: two markers and one source line', () => {
    for (const d of DIALECTS) {
      const b = codegenFor(d).sourceBlock!('/cfg/claudefob/hook.sh')
      const lines = b.split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe('# >>> claudefob >>>')
      expect(lines[2]).toBe('# <<< claudefob <<<')
    }
  })

  test('guards on the file existing, so a removed script cannot break shell startup', () => {
    expect(codegenFor('posix').sourceBlock!('/p/hook.sh')).toContain("[ -f '/p/hook.sh' ]")
    expect(codegenFor('fish').sourceBlock!('/p/hook.fish')).toContain("test -f '/p/hook.fish'")
    expect(codegenFor('powershell').sourceBlock!('C:\\p\\hook.ps1')).toContain("Test-Path 'C:\\p\\hook.ps1'")
  })

  test('a Windows path keeps single backslashes — JSON-style escaping would double them', () => {
    const b = codegenFor('powershell').sourceBlock!('C:\\Users\\a\\AppData\\Roaming\\claudefob\\hook.ps1')
    expect(b).toContain('C:\\Users\\a\\AppData\\Roaming\\claudefob\\hook.ps1')
    expect(b).not.toContain('\\\\')
  })

  test('quotes the path, so a config dir containing spaces still works', () => {
    const b = codegenFor('posix').sourceBlock!('/Users/a b/.config/claudefob/hook.sh')
    expect(b).toContain("'/Users/a b/.config/claudefob/hook.sh'")
  })

  test('the referenced script is the full hook block', () => {
    // The one-liner is only an indirection: what it sources must be the same integration.
    for (const d of DIALECTS) {
      const full = codegenFor(d).hookBlock()
      expect(full).toContain('>>> claudefob >>>')
      expect(full.length).toBeGreaterThan(codegenFor(d).sourceBlock!('/p').length)
    }
  })
})
