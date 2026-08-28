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

describe('--help and --version do not fall through to the activation picker', () => {
  test('the parent run returns early for help and version flags', () => {
    // citty invokes the parent command's run even after handling --version itself, so on an
    // interactive terminal the picker opened on top of the version output.
    const src = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8')
    expect(src).toContain("['--help', '-h', '--version', '-v'].includes(a)")
  })

  test('--version reports on stderr, leaving stdout empty', () => {
    // stdout is what the shell wrapper evals. A version number there would be run as a command:
    // "command not found: 0.3.0".
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const cli = path.join(import.meta.dir, '..', 'dist-test', 'cli.js')
    const r = spawnSync('node', [cli, '--version'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('--help reports on stderr, leaving stdout empty', () => {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const cli = path.join(import.meta.dir, '..', 'dist-test', 'cli.js')
    const r = spawnSync('node', [cli, '--help'], { encoding: 'utf8' })
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('USAGE')
  })
})
