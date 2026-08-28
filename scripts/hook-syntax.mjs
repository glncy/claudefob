#!/usr/bin/env node
// Parses every generated hook block with the real interpreter for that shell. Unit tests can only
// assert the text contains what we expect; this proves the block is syntactically valid where it
// will actually be sourced. Run after `bun run build`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CLI = path.resolve('dist/cli.js')
if (!fs.existsSync(CLI)) {
  console.error('dist/cli.js not found — run `bun run build` first.')
  process.exit(1)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudefob-hooksyntax-'))
// `init` writes hook.<ext> into the config dir. Point HOME and friends at a throwaway directory so
// running this check never leaves hook.fish / hook.ps1 in the real ~/.config/claudefob.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'claudefob-hooksyntax-home-'))
const childEnv = {
  ...process.env,
  HOME: sandbox,
  USERPROFILE: sandbox,
  XDG_CONFIG_HOME: path.join(sandbox, '.config'),
  APPDATA: path.join(sandbox, 'AppData', 'Roaming'),
}
let failures = 0
let ran = 0
const skipped = []

function block(dialect) {
  // --force: init refuses when a block is already installed on this machine, which would make
  // this check silently examine nothing.
  const res = spawnSync(process.execPath, [CLI, 'init', '--shell', dialect, '--force'], {
    encoding: 'utf8',
    env: childEnv,
  })
  if (res.status !== 0) {
    console.error(`FAIL: claudefob init --shell ${dialect} exited ${res.status}`)
    failures++
    return null
  }
  const file = path.join(dir, `hook-${dialect}${dialect === 'powershell' ? '.ps1' : '.sh'}`)
  fs.writeFileSync(file, res.stdout)
  return file
}

function have(bin) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(probe, [bin], { stdio: 'ignore' }).status === 0
}

function check(label, bin, args) {
  if (!have(bin)) {
    skipped.push(`${label} (${bin} not installed)`)
    return
  }
  ran++
  const res = spawnSync(bin, args, { encoding: 'utf8' })
  if (res.status !== 0) {
    console.error(`FAIL: ${label}\n${res.stderr || res.stdout}`)
    failures++
  } else {
    console.log(`ok: ${label}`)
  }
}

const posix = block('posix')
if (posix) {
  check('posix block parses as bash', 'bash', ['-n', posix])
  check('posix block parses as zsh', 'zsh', ['-n', posix])
}

const fish = block('fish')
if (fish) check('fish block parses as fish', 'fish', ['--no-execute', fish])

const ps = block('powershell')
if (ps) {
  // Parse without executing: the AST parser reports syntax errors and never runs the script.
  const parse = [
    '-NoProfile',
    '-Command',
    `$errors = $null; ` +
      `[System.Management.Automation.Language.Parser]::ParseFile('${ps.replace(/'/g, "''")}', [ref]$null, [ref]$errors) | Out-Null; ` +
      `if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`,
  ]
  const bin = have('pwsh') ? 'pwsh' : 'powershell'
  check('powershell block parses', bin, parse)
}

if (skipped.length) console.log(`skipped (interpreter unavailable on this runner): ${skipped.join(', ')}`)
console.log(`${ran} interpreter check(s) ran, ${failures} failure(s)`)
if (ran === 0) {
  console.error('FAIL: no interpreter was available — this check proved nothing.')
  process.exit(1)
}
process.exit(failures > 0 ? 1 : 0)
