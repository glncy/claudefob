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

describe('hook blocks carry the cross-terminal prompt sync', () => {
  test('posix registers a precmd hook for zsh and PROMPT_COMMAND for bash', () => {
    const b = codegenFor('posix').hookBlock()
    expect(b).toContain('add-zsh-hook precmd _claudefob_sync')
    expect(b).toContain('PROMPT_COMMAND="_claudefob_sync')
  })

  test('posix seeds the marker at startup, not lazily inside the hook', () => {
    // Regression: creating the marker on first sync stamps it AFTER the store changed, so the
    // very first switch made in another terminal was never picked up.
    const b = codegenFor('posix').hookBlock()
    const seedAt = b.indexOf(': > "${TMPDIR:-/tmp}/claudefob-sync-$$"')
    const funcAt = b.indexOf('_claudefob_sync() {')
    expect(seedAt).toBeGreaterThan(-1)
    expect(seedAt).toBeLessThan(funcAt)
  })

  test('posix sync uses only builtins on the unchanged path — no fork per prompt', () => {
    const b = codegenFor('posix').hookBlock()
    const fn = b.slice(b.indexOf('_claudefob_sync() {'), b.indexOf('if [ -n "${ZSH_VERSION:-}" ]'))
    // The guard that runs on every prompt must be `[ -nt ]` plus `: >`, both shell builtins.
    expect(fn).toContain('-nt "$__cf_marker"')
    expect(fn).not.toContain('stat ')
    expect(fn).not.toContain('date ')
  })

  test('fish binds the sync to the fish_prompt event', () => {
    const b = codegenFor('fish').hookBlock()
    expect(b).toContain('--on-event fish_prompt')
    expect(b).toContain('--sync')
  })

  test('powershell wraps prompt and preserves the original', () => {
    const b = codegenFor('powershell').hookBlock()
    expect(b).toContain('__claudefob_origPrompt')
    expect(b).toContain('--sync')
  })

  test('every dialect keeps its fence markers intact', () => {
    for (const d of ['posix', 'fish', 'powershell'] as const) {
      const b = codegenFor(d).hookBlock()
      expect(b.startsWith('# >>> claudefob >>>')).toBe(true)
      expect(b.trimEnd().endsWith('# <<< claudefob <<<')).toBe(true)
    }
  })
})

describe('hook blocks degrade quietly when the binary is absent', () => {
  test('posix wraps everything in a command -v guard', () => {
    // Regression: without this, a shell whose PATH lacks claudefob (uninstalled, or installed
    // under a different Node version by fnm/nvm) prints "command not found" on every startup.
    const b = codegenFor('posix').hookBlock()
    const lines = b.split('\n')
    expect(lines[1]).toBe('if command -v claudefob >/dev/null 2>&1; then')
    expect(lines[lines.length - 2]).toBe('fi')
  })

  test('fish wraps everything in a command -v guard', () => {
    const b = codegenFor('fish').hookBlock()
    const lines = b.split('\n')
    expect(lines[3]).toBe('if command -v claudefob >/dev/null 2>&1')
    expect(lines[lines.length - 2]).toBe('end')
  })

  test('no executable line in the posix block sits outside the guard', () => {
    const b = codegenFor('posix').hookBlock()
    const inner = b.split('\n').slice(2, -2)
    for (const line of inner) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue
      expect(line.startsWith('  ')).toBe(true)
    }
  })
})

describe('sync fires before a command as well as before the prompt', () => {
  test('zsh registers both precmd and preexec', () => {
    // Regression: with precmd alone, the first command typed after a switch made in another
    // terminal still ran with the old value — only the command after it was correct.
    const b = codegenFor('posix').hookBlock()
    expect(b).toContain('add-zsh-hook precmd _claudefob_sync')
    expect(b).toContain('add-zsh-hook preexec _claudefob_sync')
  })

  test('fish binds both fish_prompt and fish_preexec', () => {
    const b = codegenFor('fish').hookBlock()
    expect(b).toContain('--on-event fish_prompt --on-event fish_preexec')
  })
})
