import { describe, expect, test } from 'bun:test'
import { needsLeadingBlankLine } from '../src/pad.ts'
import { makeTmpHome } from './helpers/tmpHome.ts'
import fs from 'node:fs'
import path from 'node:path'

function withFile(contents: string, fn: (p: string) => void) {
  const home = makeTmpHome()
  const f = path.join(home.home, 'rc')
  fs.writeFileSync(f, contents)
  try {
    fn(f)
  } finally {
    home.cleanup()
  }
}

describe('needsLeadingBlankLine', () => {
  test('pads when the file ends with content', () => {
    withFile('export FOO=1\n', (f) => expect(needsLeadingBlankLine(f)).toBe(true))
  })

  test('does not pad when the file already ends with a blank line', () => {
    // This is the case that produced two blank lines before the block.
    withFile('export FOO=1\n\n', (f) => expect(needsLeadingBlankLine(f)).toBe(false))
  })

  test('does not pad for several trailing blank lines either', () => {
    withFile('export FOO=1\n\n\n', (f) => expect(needsLeadingBlankLine(f)).toBe(false))
  })

  test('does not pad an empty or whitespace-only file', () => {
    withFile('', (f) => expect(needsLeadingBlankLine(f)).toBe(false))
    withFile('\n  \n', (f) => expect(needsLeadingBlankLine(f)).toBe(false))
  })

  test('does not pad when the file does not exist', () => {
    expect(needsLeadingBlankLine('/nonexistent/path/rc')).toBe(false)
  })

  test('pads when no file is known, since jamming is the worse failure', () => {
    expect(needsLeadingBlankLine(undefined)).toBe(true)
  })

  test('treats a CRLF file the same as LF', () => {
    withFile('export FOO=1\r\n\r\n', (f) => expect(needsLeadingBlankLine(f)).toBe(false))
    withFile('export FOO=1\r\n', (f) => expect(needsLeadingBlankLine(f)).toBe(true))
  })

  test('a file ending without any newline still gets separation', () => {
    withFile('export FOO=1', (f) => expect(needsLeadingBlankLine(f)).toBe(true))
  })
})
