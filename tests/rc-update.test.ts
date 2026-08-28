import { describe, expect, test } from 'bun:test'
import { replaceBlocks, writeFileAtomic } from '../src/rc-update.ts'
import { makeTmpHome } from './helpers/tmpHome.ts'
import fs from 'node:fs'
import path from 'node:path'

const OLD = ['# >>> claudefob >>>', 'old line one', 'old line two', '# <<< claudefob <<<'].join('\n')
const NEW = ['# >>> claudefob >>>', 'new line', '# <<< claudefob <<<'].join('\n')

describe('replaceBlocks', () => {
  test('replaces the block and leaves surrounding content byte-identical', () => {
    const before = `export FOO=1\n${OLD}\nexport BAR=2\n`
    const r = replaceBlocks(before, NEW)
    expect(r.replaced).toBe(1)
    expect(r.text).toBe(`export FOO=1\n${NEW}\nexport BAR=2\n`)
  })

  test('never inserts a block into a file that has none', () => {
    // claudefob only rewrites what the user installed; it must not add integration on its own.
    const before = 'export FOO=1\n'
    const r = replaceBlocks(before, NEW)
    expect(r.replaced).toBe(0)
    expect(r.text).toBe(before)
  })

  test('reports unchanged when the file already has exactly this block', () => {
    const before = `export FOO=1\n${NEW}\n`
    const r = replaceBlocks(before, NEW)
    expect(r.unchanged).toBe(true)
  })

  test('replaces every block when one was installed more than once', () => {
    const before = `${OLD}\nmiddle\n${OLD}\n`
    const r = replaceBlocks(before, NEW)
    expect(r.replaced).toBe(2)
    expect(r.text).toBe(`${NEW}\nmiddle\n${NEW}\n`)
  })

  test('leaves an unterminated block alone rather than eating the rest of the file', () => {
    const before = '# >>> claudefob >>>\nno closing marker\nexport KEEP=1\n'
    const r = replaceBlocks(before, NEW)
    expect(r.replaced).toBe(0)
    expect(r.text).toBe(before)
  })

  test('preserves content that merely mentions claudefob outside the markers', () => {
    const before = `# claudefob is great\n${OLD}\nalias cf=claudefob\n`
    const r = replaceBlocks(before, NEW)
    expect(r.text).toContain('# claudefob is great')
    expect(r.text).toContain('alias cf=claudefob')
  })
})

describe('writeFileAtomic', () => {
  test('writes the content and preserves the file mode', () => {
    const home = makeTmpHome()
    const f = path.join(home.home, 'rc')
    fs.writeFileSync(f, 'before\n', { mode: 0o600 })
    writeFileAtomic(f, 'after\n')
    expect(fs.readFileSync(f, 'utf8')).toBe('after\n')
    expect(fs.statSync(f).mode & 0o777).toBe(0o600)
    home.cleanup()
  })

  test('leaves no temp file behind', () => {
    const home = makeTmpHome()
    const f = path.join(home.home, 'rc')
    fs.writeFileSync(f, 'x\n')
    writeFileAtomic(f, 'y\n')
    expect(fs.readdirSync(home.home).filter((n) => n.includes('claudefob-tmp'))).toHaveLength(0)
    home.cleanup()
  })
})
