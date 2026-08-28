#!/usr/bin/env node
// Integration test against the real release bundle (dist/cli.js) and the real OS keystore.
// Run after `bun run build`. See PLAN.md §7.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const cliPath = path.resolve('dist/cli.js')
if (!fs.existsSync(cliPath)) {
  console.error('dist/cli.js not found — run `bun run build` first.')
  process.exit(1)
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudefob-itest-'))
const xdg = path.join(home, '.config')
fs.mkdirSync(xdg, { recursive: true })
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg }
const tokenName = `itest-${Date.now()}`
const tokenValue = `sk-ant-integration-${Math.random().toString(36).slice(2)}`

function run(args, opts = {}) {
  return spawnSync('node', [cliPath, ...args], { env, encoding: 'utf8', ...opts })
}

function fail(msg) {
  console.error(`INTEGRATION FAIL: ${msg}`)
  process.exit(1)
}

// 1. add via piped stdin (real prompt, no test hook exists against dist/cli.js).
const addRes = run(['add', tokenName, '--description', 'integration'], { input: tokenValue + '\n' })
if (addRes.status !== 0) fail(`add exited ${addRes.status}: ${addRes.stderr}`)

// 2. use it.
const useRes = run(['use', tokenName, '--shell', 'posix'])
if (useRes.status !== 0) fail(`use exited ${useRes.status}: ${useRes.stderr}`)
if (!useRes.stdout.includes(tokenValue)) fail(`use stdout did not contain the token: ${useRes.stdout}`)

// 3. Assert the emitted code actually sets the variable in a real shell.
function assertSetsVar(shellCmd, args) {
  const script = `${useRes.stdout.trim()}\necho "RESULT=$CLAUDE_CODE_OAUTH_TOKEN"`
  const res = spawnSync(shellCmd, [...args, script], { encoding: 'utf8' })
  if (!res.stdout.includes(`RESULT=${tokenValue}`)) {
    fail(`${shellCmd} did not set the variable. stdout: ${res.stdout} stderr: ${res.stderr}`)
  }
}

if (process.platform === 'win32') {
  const psScript = `${useRes.stdout.trim()}\nWrite-Output "RESULT=$env:CLAUDE_CODE_OAUTH_TOKEN"`
  const res = spawnSync('pwsh', ['-Command', psScript], { encoding: 'utf8' })
  if (!res.stdout.includes(`RESULT=${tokenValue}`)) fail(`pwsh did not set the variable: ${res.stdout}`)
} else {
  assertSetsVar('bash', ['-c'])
  const zsh = spawnSync('which', ['zsh'])
  if (zsh.status === 0) assertSetsVar('zsh', ['-c'])
  const fish = spawnSync('which', ['fish'])
  if (fish.status === 0) {
    const fishUse = run(['use', tokenName, '--shell', 'fish'])
    const fishScript = `${fishUse.stdout.trim()}\necho "RESULT=$CLAUDE_CODE_OAUTH_TOKEN"`
    const res = spawnSync('fish', ['-c', fishScript], { encoding: 'utf8' })
    if (!res.stdout.includes(`RESULT=${tokenValue}`)) fail(`fish did not set the variable: ${res.stdout}`)
  }
}

// 4. `show`'s success path is not exercised here (auth is interactive by design); assert the
//    negative instead: CLAUDEFOB_FAKE_AUTH=1 must be dead code against the release bundle.
const showRes = run(['show', tokenName], { env: { ...env, CLAUDEFOB_FAKE_AUTH: '1' } })
if (showRes.status !== 3) fail(`show with CLAUDEFOB_FAKE_AUTH=1 against dist/cli.js should exit 3, got ${showRes.status}`)
if (showRes.stdout.includes(tokenValue) || showRes.stderr.includes(tokenValue)) {
  fail('show leaked the token despite a failed/bypassed auth gate')
}

// 5. Clean up.
const removeRes = run(['remove', tokenName, '--yes'])
if (removeRes.status !== 0) fail(`remove exited ${removeRes.status}: ${removeRes.stderr}`)

fs.rmSync(home, { recursive: true, force: true })
console.log('INTEGRATION OK')
