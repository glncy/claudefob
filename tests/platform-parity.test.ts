import { describe, expect, test } from 'bun:test'
import { codegenFor, type ShellDialect } from '../src/shell/index.ts'

const DIALECTS: ShellDialect[] = ['posix', 'fish', 'powershell']

// Every dialect must implement the same five behaviours. Parity was previously assumed and drifted
// twice in the wild: the missing-binary guard and the pre-command sync each shipped for some
// shells and not others.
const REQUIRED: Record<string, Partial<Record<ShellDialect, RegExp>>> = {
  'guards against claudefob not being on PATH': {
    posix: /if command -v claudefob >\/dev\/null 2>&1; then/,
    fish: /if command -v claudefob >\/dev\/null 2>&1/,
    powershell: /if \(Get-Command claudefob -CommandType Application -ErrorAction SilentlyContinue\)/,
  },
  'applies the active token at startup': {
    posix: /eval "\$\(command claudefob export --shell posix\)"/,
    fish: /eval \(command claudefob export --shell fish\)/,
    powershell: /claudefob export --shell powershell \| Out-String/,
  },
  'defines the wrapper that patches the current shell': {
    posix: /^\s*claudefob\(\) \{/m,
    fish: /^\s*function claudefob$/m,
    powershell: /^\s*function claudefob \{/m,
  },
  'syncs after a command, before the next prompt': {
    posix: /add-zsh-hook precmd _claudefob_sync|PROMPT_COMMAND="_claudefob_sync/,
    fish: /--on-event fish_prompt/,
    powershell: /^\s*function prompt \{/m,
  },
  'syncs before the command you just typed': {
    posix: /add-zsh-hook preexec _claudefob_sync/,
    fish: /--on-event fish_preexec/,
    powershell: /Set-PSReadLineKeyHandler -Chord Enter/,
  },
}

describe('hook block parity across every supported shell', () => {
  for (const [behaviour, perDialect] of Object.entries(REQUIRED)) {
    for (const d of DIALECTS) {
      test(`${d} ${behaviour}`, () => {
        const pattern = perDialect[d]
        expect(pattern).toBeDefined()
        expect(codegenFor(d).hookBlock()).toMatch(pattern!)
      })
    }
  }

  test('bash also gets a pre-command sync, via a guarded DEBUG trap', () => {
    // bash has no preexec; the DEBUG trap stands in, but only when nothing else owns it.
    const b = codegenFor('posix').hookBlock()
    expect(b).toContain('trap -p DEBUG')
    expect(b).toContain('_claudefob_armed')
  })

  test('every dialect fences its block with the same markers', () => {
    for (const d of DIALECTS) {
      const b = codegenFor(d).hookBlock()
      expect(b.split('\n')[0]).toBe('# >>> claudefob >>>')
      expect(b.trimEnd().split('\n').pop()).toBe('# <<< claudefob <<<')
    }
  })

  test('no dialect writes anything to stdout from inside the block', () => {
    // A stray echo/Write-Host in a startup file would be captured by the wrapper's eval.
    expect(codegenFor('posix').hookBlock()).not.toMatch(/^\s*echo /m)
    expect(codegenFor('fish').hookBlock()).not.toMatch(/^\s*echo /m)
    expect(codegenFor('powershell').hookBlock()).not.toMatch(/Write-Host/)
  })
})

describe('fish handles multi-line shell code correctly', () => {
  test('every fish eval of claudefob output pipes through `string collect`', () => {
    // fish splits command substitution on newlines into separate arguments. Without `string
    // collect` a two-line export was flattened into one command and the token absorbed the
    // following line — CLAUDE_CODE_OAUTH_TOKEN came out as
    // "sk-ant-... set -gx CLAUDEFOB_APPLIED work".
    const b = codegenFor('fish').hookBlock()
    const evals = b.split('\n').filter((l) => l.includes('claudefob export --shell fish'))
    expect(evals.length).toBeGreaterThan(0)
    for (const line of evals) {
      expect(line).toContain('string collect')
    }
  })

  test('export emits more than one line, which is why this matters', () => {
    const b = codegenFor('fish')
    const two = [b.setEnv('A', 'x'), b.setEnv('B', 'y')].join('\n')
    expect(two.split('\n')).toHaveLength(2)
  })
})
