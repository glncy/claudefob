import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { makeTmpHome } from './helpers/tmpHome.ts'
import { scanFenceBlocks as scan } from '../src/rc-scan.ts'

describe('rc file fenced-block scan', () => {
  test('detects a single block with correct line numbers', () => {
    const text = 'line1\nline2\n# >>> claudefob >>>\nexport X=1\n# <<< claudefob <<<\nline6\n'
    const blocks = scan(text)
    expect(blocks).toEqual([{ start: 3, end: 5 }])
  })

  test('detects multiple blocks', () => {
    const text = [
      '# >>> claudefob >>>',
      'a',
      '# <<< claudefob <<<',
      'unrelated',
      '# >>> claudefob >>>',
      'b',
      '# <<< claudefob <<<',
    ].join('\n')
    const blocks = scan(text)
    expect(blocks.length).toBe(2)
    expect(blocks[0]).toEqual({ start: 1, end: 3 })
    expect(blocks[1]).toEqual({ start: 5, end: 7 })
  })

  test('unterminated block reports no end', () => {
    const text = '# >>> claudefob >>>\nexport X=1\n'
    const blocks = scan(text)
    expect(blocks).toEqual([])
  })

  test('reports every block, not just the first, and ignores a trailing unterminated opener', () => {
    const text = [
      '# >>> claudefob >>>',
      'a',
      '# <<< claudefob <<<',
      'unrelated',
      '# >>> claudefob >>>',
      'b',
      '# <<< claudefob <<<',
      'unrelated2',
      '# >>> claudefob >>>',
      'dangling, never closed',
    ].join('\n')
    const blocks = scan(text)
    // Regression: two global findIndex() calls (one for '>>>', one for '<<<') would find only
    // the *first* occurrence of each marker and report a single bogus block spanning from the
    // first opener to the first closer, silently dropping the second real block.
    expect(blocks).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 7 },
    ])
  })

  test('absent file: reading throws ENOENT, scan is skipped by caller', () => {
    const home = makeTmpHome()
    try {
      const p = path.join(home.home, '.zshrc')
      expect(() => fs.readFileSync(p, 'utf8')).toThrow()
    } finally {
      home.cleanup()
    }
  })
})

describe('init refuses to duplicate an existing block', () => {
  test('it names every install, offers removal, and exits rather than appending', () => {
    // init cannot see the shell redirect, so reading the known startup files is the only way it
    // can notice an existing install. A warning alone was not enough — `>>` appends stdout
    // regardless of exit code, so it must also emit nothing.
    const src = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8')
    const block = src.match(/const initCommand[\s\S]*?\n\}\)\n/)
    expect(block).not.toBeNull()
    expect(block![0]).toContain('already installed in')
    expect(block![0]).toContain('Appending again would duplicate the block')
    expect(block![0]).toContain('scanFenceBlocks')
    expect(block![0]).toContain('process.exit(2)')
    expect(block![0]).toContain('args.force')
  })
})

describe('programmatic callers of init are not blocked by the duplicate refusal', () => {
  test('update refreshes hook scripts with --force', () => {
    // Regression: the refusal fires when a block is installed, which is exactly the situation
    // `claudefob update` runs in — without --force it would refuse to refresh anything.
    const src = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8')
    const fn = src.match(/async function refreshInstalledHooks[\s\S]*?\n\}\n/)
    expect(fn).not.toBeNull()
    for (const call of fn![0].match(/spawnSync\('claudefob', \[[^\]]*\]/g) ?? []) {
      expect(call).toContain("'--force'")
    }
  })
})
