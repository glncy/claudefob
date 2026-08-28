import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (entry.name.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('only ui/prompts.ts imports @clack/prompts', () => {
  test('no other src/** file imports @clack/prompts', () => {
    const srcDir = path.join(import.meta.dir, '..', 'src')
    const files = walk(srcDir)
    const offenders = files.filter((f) => {
      if (f.endsWith(path.join('ui', 'prompts.ts'))) return false
      return fs.readFileSync(f, 'utf8').includes('@clack/prompts')
    })
    expect(offenders).toEqual([])
  })
})
