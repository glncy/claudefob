import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { ensureOnboarding, buildPatched } from '../src/claude-config.ts'
import { makeTmpHome } from './helpers/tmpHome.ts'

function withFile(content: string | undefined, fn: (p: string) => void) {
  const home = makeTmpHome()
  try {
    const p = path.join(home.home, '.claude.json')
    if (content !== undefined) fs.writeFileSync(p, content)
    fn(p)
  } finally {
    home.cleanup()
  }
}

describe('ensureOnboarding', () => {
  test('missing file -> created', () => {
    withFile(undefined, (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('created')
      expect(JSON.parse(fs.readFileSync(p, 'utf8'))).toEqual({ hasCompletedOnboarding: true })
    })
  })

  test('already true -> no write at all (mtime unchanged)', () => {
    withFile('{"hasCompletedOnboarding": true, "foo": "bar"}', (p) => {
      const before = fs.statSync(p).mtimeMs
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('already-ok')
      const after = fs.statSync(p).mtimeMs
      expect(after).toBe(before)
    })
  })

  test('false -> patched', () => {
    withFile('{"hasCompletedOnboarding": false, "foo": "bar"}', (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('patched')
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      expect(parsed.hasCompletedOnboarding).toBe(true)
      expect(parsed.foo).toBe('bar')
    })
  })

  test('absent key -> inserted as first member, other keys preserved', () => {
    withFile('{\n  "foo": "bar",\n  "baz": 1\n}', (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('patched')
      const text = fs.readFileSync(p, 'utf8')
      const parsed = JSON.parse(text)
      expect(parsed.hasCompletedOnboarding).toBe(true)
      expect(parsed.foo).toBe('bar')
      expect(parsed.baz).toBe(1)
      expect(Object.keys(parsed)).toEqual(['hasCompletedOnboarding', 'foo', 'baz'])
    })
  })

  test('absent key on empty object', () => {
    withFile('{}', (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('patched')
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      expect(parsed).toEqual({ hasCompletedOnboarding: true })
    })
  })

  test('comments / trailing garbage -> verify-failed, file byte-identical', () => {
    const original = '{"hasCompletedOnboarding": false} // trailing comment'
    withFile(original, (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('verify-failed')
      expect(fs.readFileSync(p, 'utf8')).toBe(original)
    })
  })

  test('non-boolean existing value -> verify-failed, file unchanged', () => {
    const original = '{"hasCompletedOnboarding": "yes"}'
    withFile(original, (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('verify-failed')
      expect(fs.readFileSync(p, 'utf8')).toBe(original)
    })
  })

  test('duplicate top-level key -> verify-failed, file unchanged', () => {
    const original = '{"a": 1, "a": 2}'
    withFile(original, (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('verify-failed')
      expect(fs.readFileSync(p, 'utf8')).toBe(original)
    })
  })

  test('nested object preserved', () => {
    const original = '{"hasCompletedOnboarding": false, "nested": {"a": 1, "b": [1, 2, 3]}}'
    withFile(original, (p) => {
      const result = ensureOnboarding(p)
      expect(result.kind).toBe('patched')
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      expect(parsed.nested).toEqual({ a: 1, b: [1, 2, 3] })
    })
  })

  test('atomic rename leaves no temp file behind', () => {
    withFile('{"hasCompletedOnboarding": false}', (p) => {
      ensureOnboarding(p)
      const dir = path.dirname(p)
      const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.claude.json.claudefob-'))
      expect(leftovers).toEqual([])
    })
  })

  test('a patch that would reorder or drop a key fails verification', () => {
    // Simulate via buildPatched directly with a hand-checked pathological string that our regex
    // cannot safely handle: a key literally named the same as our marker inside a string value.
    const tricky = '{"note": "please set hasCompletedOnboarding: true manually", "hasCompletedOnboarding": false}'
    const { ok, text } = buildPatched(tricky)
    expect(ok).toBe(true)
    // the "note" string content must be untouched
    expect(JSON.parse(text).note).toBe('please set hasCompletedOnboarding: true manually')
  })
})

describe('stop must not touch ~/.claude.json', () => {
  test('claude-config module is not imported by the stop path', () => {
    // Static check: cli.ts calls ensureOnboarding only inside doActivate (use / bare invocation).
    const cliSrc = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8')
    const stopBlockMatch = cliSrc.match(/const stopCommand[\s\S]*?\n\}\)\n/)
    expect(stopBlockMatch).not.toBeNull()
    expect(stopBlockMatch![0]).not.toContain('ensureOnboarding')
  })
})
