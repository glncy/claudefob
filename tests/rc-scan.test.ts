import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { makeTmpHome } from './helpers/tmpHome.ts'

// Mirrors the scan logic in cli.ts's guide command: find fenced-block start/end line numbers.
function scan(text: string): { start: number; end: number }[] {
  const lines = text.split('\n')
  const blocks: { start: number; end: number }[] = []
  let start = -1
  lines.forEach((l, i) => {
    if (l.includes('>>> claudefob >>>')) start = i
    if (l.includes('<<< claudefob <<<')) {
      blocks.push({ start: start === -1 ? -1 : start + 1, end: i + 1 })
      start = -1
    }
  })
  return blocks
}

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
