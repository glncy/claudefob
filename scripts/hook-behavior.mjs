#!/usr/bin/env node
// Functionally exercises each hook block in its real shell: sources it, asserts the active token
// lands in the environment, then deactivates the store and asserts the sync clears it.
//
// hook-syntax.mjs only proves the blocks parse. This proves they work — the fish and PowerShell
// blocks were never actually executed anywhere before this.
//
// Requires dist-test/cli.js (the bundle with the fake-keystore seam). Run after `bun run build:test`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CLI = path.resolve('dist-test/cli.js')
if (!fs.existsSync(CLI)) {
  console.error('dist-test/cli.js not found — run `bun run build:test` first.')
  process.exit(1)
}

const VAR = 'CLAUDE_CODE_OAUTH_TOKEN'
const TOKEN = 'sk-ant-behaviour-check'
const isWin = process.platform === 'win32'
let failures = 0
let ran = 0
const skipped = []

function have(bin) {
  return spawnSync(isWin ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0
}

/** A temp HOME with an active token, plus a `claudefob` shim on PATH pointing at dist-test. */
function makeEnv(tag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `claudefob-behaviour-${tag}-`))
  const configHome = path.join(home, '.config')
  const appData = path.join(home, 'AppData', 'Roaming')
  const storeDir = path.join(isWin ? appData : configHome, 'claudefob')
  fs.mkdirSync(storeDir, { recursive: true })

  const fakeKeystore = path.join(home, 'keystore.json')
  fs.writeFileSync(fakeKeystore, JSON.stringify({ work: TOKEN }))
  const storePath = path.join(storeDir, 'store.json')
  fs.writeFileSync(
    storePath,
    JSON.stringify({
      version: 1,
      active: 'work',
      tokens: [{ name: 'work', createdAt: '2026-01-01T00:00:00.000Z', last4: TOKEN.slice(-4) }],
    }),
  )

  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  if (isWin) {
    fs.writeFileSync(path.join(bin, 'claudefob.cmd'), `@echo off\r\n"${process.execPath}" "${CLI}" %*\r\n`)
    // npm also installs an extensionless shell script for Git Bash / MSYS, which resolves
    // `command -v claudefob` there; without it the guard correctly finds nothing.
    fs.writeFileSync(path.join(bin, 'claudefob'), `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, '/')}" "${CLI.replace(/\\/g, '/')}" "$@"\n`, { mode: 0o755 })
  } else {
    const shim = path.join(bin, 'claudefob')
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 })
  }

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: configHome,
    APPDATA: appData,
    CLAUDEFOB_FAKE_KEYSTORE: fakeKeystore,
    CLAUDEFOB_NO_UPDATE_CHECK: '1',
    PATH: bin + path.delimiter + process.env.PATH,
  }
  return { home, env, storePath }
}

function writeHook(env, dialect) {
  const res = spawnSync('claudefob', ['init', '--shell', dialect, '--force'], { env, encoding: 'utf8', shell: isWin })
  if (res.status !== 0) throw new Error(`init --shell ${dialect} exited ${res.status}: ${res.stderr}`)
  const ext = dialect === 'fish' ? 'fish' : dialect === 'powershell' ? 'ps1' : 'sh'
  const p = path.join(isWin ? env.APPDATA : env.XDG_CONFIG_HOME, 'claudefob', `hook.${ext}`)
  if (!fs.existsSync(p)) throw new Error(`init did not write ${p}`)
  return p
}

function deactivate(storePath) {
  const s = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  s.active = null
  fs.writeFileSync(storePath, JSON.stringify(s))
  // The posix sync compares mtimes against a marker stamped at shell start; make sure the store is
  // unambiguously newer even on filesystems with coarse timestamps.
  const future = new Date(Date.now() + 2000)
  fs.utimesSync(storePath, future, future)
}

function assertRun(label, bin, args, env, expectations) {
  ran++
  const res = spawnSync(bin, args, { env, encoding: 'utf8' })
  const out = (res.stdout || '') + (res.stderr || '')
  for (const [what, ok] of Object.entries(expectations(out))) {
    if (!ok) {
      console.error(`FAIL: ${label} — ${what}\n--- output ---\n${out}`)
      failures++
      return
    }
  }
  console.log(`ok: ${label}`)
}

// --- posix (bash and zsh) ---
for (const sh of ['bash', 'zsh']) {
  if (!have(sh)) {
    skipped.push(`${sh} (not installed)`)
    continue
  }
  const { env, storePath } = makeEnv(sh)
  const hook = writeHook(env, 'posix')
  assertRun(
    `${sh}: sourcing the hook applies the active token`,
    sh,
    ['-c', `. '${hook}'; echo "TOKEN=[$${VAR}] HOOK=[$CLAUDEFOB_HOOK]"`],
    env,
    (out) => ({
      'token is exported': out.includes(`TOKEN=[${TOKEN}]`),
      'hook marker is set': out.includes('HOOK=[1]'),
    }),
  )

  deactivate(storePath)
  assertRun(
    `${sh}: sync clears the token after deactivation elsewhere`,
    sh,
    ['-c', `. '${hook}'; _claudefob_sync; echo "TOKEN=[$${VAR}]"`],
    env,
    (out) => ({ 'token is cleared': out.includes('TOKEN=[]') }),
  )
}

// --- fish ---
if (have('fish')) {
  const { env, storePath } = makeEnv('fish')
  const hook = writeHook(env, 'fish')
  assertRun(
    'fish: sourcing the hook applies the active token',
    'fish',
    ['-c', `source '${hook}'; echo "TOKEN=[$${VAR}] HOOK=[$CLAUDEFOB_HOOK]"`],
    env,
    (out) => ({
      'token is exported': out.includes(`TOKEN=[${TOKEN}]`),
      'hook marker is set': out.includes('HOOK=[1]'),
    }),
  )
  deactivate(storePath)
  assertRun(
    'fish: sync clears the token after deactivation elsewhere',
    'fish',
    ['-c', `source '${hook}'; _claudefob_sync; echo "TOKEN=[$${VAR}]"`],
    env,
    (out) => ({ 'token is cleared': out.includes('TOKEN=[]') }),
  )
} else {
  skipped.push('fish (not installed)')
}

// --- PowerShell ---
const psBin = have('pwsh') ? 'pwsh' : have('powershell') ? 'powershell' : null
if (psBin) {
  const { env, storePath } = makeEnv('ps')
  const hook = writeHook(env, 'powershell')
  assertRun(
    `${psBin}: dot-sourcing the hook applies the active token`,
    psBin,
    ['-NoProfile', '-Command', `. '${hook}'; "TOKEN=[$env:${VAR}] HOOK=[$env:CLAUDEFOB_HOOK]"`],
    env,
    (out) => ({
      'token is exported': out.includes(`TOKEN=[${TOKEN}]`),
      'hook marker is set': out.includes('HOOK=[1]'),
    }),
  )
  deactivate(storePath)
  assertRun(
    `${psBin}: sync clears the token after deactivation elsewhere`,
    psBin,
    ['-NoProfile', '-Command', `. '${hook}'; __claudefob_sync; "TOKEN=[$env:${VAR}]"`],
    env,
    (out) => ({ 'token is cleared': out.includes('TOKEN=[]') }),
  )
} else {
  skipped.push('powershell (not installed)')
}

if (skipped.length) console.log(`skipped: ${skipped.join(', ')}`)
console.log(`${ran} behaviour check(s) ran, ${failures} failure(s)`)
if (ran === 0) {
  console.error('FAIL: no shell was available — this check proved nothing.')
  process.exit(1)
}
process.exit(failures > 0 ? 1 : 0)
