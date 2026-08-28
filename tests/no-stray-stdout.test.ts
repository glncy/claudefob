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

describe('stdout discipline (SPEC §3)', () => {
  const srcDir = path.join(import.meta.dir, '..', 'src')
  const files = walk(srcDir)

  test('process.stdout.write appears only in ui/out.ts', () => {
    const offenders = files.filter((f) => {
      if (f.endsWith(path.join('ui', 'out.ts'))) return false
      return fs.readFileSync(f, 'utf8').includes('process.stdout')
    })
    expect(offenders).toEqual([])
  })

  test('console.log is banned in src/, except the routing shim in cli.ts', () => {
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, 'utf8')
      if (!text.includes('console.log')) return false
      if (f.endsWith(path.join('src', 'cli.ts'))) return false
      return true
    })
    expect(offenders).toEqual([])
  })
})

describe('the update command keeps package-manager output off stdout', () => {
  test('child stdout is redirected to fd 2, never plain inherit', () => {
    // Regression: `stdio: 'inherit'` sent npm's own output to stdout, where the shell function
    // wrapper eval'd it — "changed 11 packages" ran as the command `changed`.
    const src = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8')
    const block = src.match(/const updateCommand[\s\S]*?\n\}\)\n/)
    expect(block).not.toBeNull()
    expect(block![0]).toContain("stdio: ['inherit', 2, 'inherit']")
    expect(block![0]).not.toContain("stdio: 'inherit'")
  })
})
