import { describe, expect, test } from 'bun:test'
import { codegenFor, parseShellFlag } from '../src/shell/index.ts'
import { UsageError } from '../src/ui/errors.ts'

describe('posix codegen', () => {
  const g = codegenFor('posix')
  test('setEnv', () => {
    expect(g.setEnv('X', 'abc')).toBe("export X='abc'")
  })
  test('unsetEnv', () => {
    expect(g.unsetEnv('X')).toBe('unset X')
  })
  test('quoting: single quote', () => {
    expect(g.quote("a'b")).toBe("'a'\\''b'")
  })
  test('quoting: empty', () => {
    expect(g.quote('')).toBe("''")
  })
  test('quoting: backslash', () => {
    expect(g.quote('a\\b')).toBe("'a\\b'")
  })
  test('quoting: newline', () => {
    expect(g.quote('a\nb')).toBe("'a\nb'")
  })
  test('quoting: unicode', () => {
    expect(g.quote('日本語')).toBe("'日本語'")
  })
  test('escaping is unconditional even without special chars', () => {
    expect(g.quote('plain')).toBe("'plain'")
  })
})

describe('fish codegen', () => {
  const g = codegenFor('fish')
  test('setEnv', () => {
    expect(g.setEnv('X', 'abc')).toBe("set -gx X 'abc'")
  })
  test('unsetEnv', () => {
    expect(g.unsetEnv('X')).toBe('set -e X')
  })
  test('quoting: single quote uses backslash escape, not posix idiom', () => {
    expect(g.quote("a'b")).toBe("'a\\'b'")
  })
  test('quoting: backslash doubled first', () => {
    expect(g.quote('a\\b')).toBe("'a\\\\b'")
  })
  test('quoting: backslash then quote composes correctly', () => {
    expect(g.quote("a\\'b")).toBe("'a\\\\\\'b'")
  })
})

describe('powershell codegen', () => {
  const g = codegenFor('powershell')
  test('setEnv', () => {
    expect(g.setEnv('X', 'abc')).toBe("$env:X='abc'")
  })
  test('unsetEnv', () => {
    expect(g.unsetEnv('X')).toBe('Remove-Item Env:\\X -ErrorAction SilentlyContinue')
  })
  test('quoting: single quote doubled', () => {
    expect(g.quote("a'b")).toBe("'a''b'")
  })
})

describe('parseShellFlag', () => {
  test('accepts known dialects', () => {
    expect(parseShellFlag('posix')).toBe('posix')
    expect(parseShellFlag('fish')).toBe('fish')
    expect(parseShellFlag('powershell')).toBe('powershell')
  })
  test('cmd throws UsageError pointing at PowerShell', () => {
    expect(() => parseShellFlag('cmd')).toThrow(UsageError)
    try {
      parseShellFlag('cmd')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('PowerShell')
    }
  })
  test('unknown shell throws UsageError', () => {
    expect(() => parseShellFlag('tcsh')).toThrow(UsageError)
  })
})

describe('hookBlock', () => {
  test('posix block matches SPEC §3', () => {
    const block = codegenFor('posix').hookBlock()
    expect(block).toContain('# >>> claudefob >>>')
    expect(block).toContain('export CLAUDEFOB_HOOK=1')
    expect(block).toContain('eval "$(command claudefob export --shell posix)"')
    expect(block).toContain('|| return $?')
    expect(block).toContain('# <<< claudefob <<<')
  })
  test('fish block propagates failure and guards empty output', () => {
    const block = codegenFor('fish').hookBlock()
    expect(block).toContain('or return $status')
    expect(block).toContain('test -n "$__cf_out"; and eval $__cf_out')
  })
  test('powershell block guards empty Invoke-Expression', () => {
    const block = codegenFor('powershell').hookBlock()
    expect(block).toContain('if ($__cf.Trim())')
    expect(block).toContain('if ($LASTEXITCODE -ne 0) { return }')
  })
})
