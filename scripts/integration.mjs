#!/usr/bin/env node
// Integration test against the real release bundle (dist/cli.js) and the real OS keystore.
// Run after `bun run build`. See PLAN.md §7.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const cliPath = path.resolve('dist/cli.js')
if (!fs.existsSync(cliPath)) {
  console.error('dist/cli.js not found — run `bun run build` first.')
  process.exit(1)
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudefob-itest-'))
const xdg = path.join(home, '.config')
fs.mkdirSync(xdg, { recursive: true })
const appData = path.join(home, 'AppData', 'Roaming')
fs.mkdirSync(appData, { recursive: true })
// Override every home-derived var so a real run never touches the machine's actual
// store.json, ~/.claude.json, or (on Windows) APPDATA-relative paths. Windows-critical
// vars are inherited (not dropped) so spawning node itself stays reliable there.
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: xdg,
  APPDATA: appData,
}
const tokenName = `itest-${Date.now()}`
const tokenValue = `sk-ant-integration-${Math.random().toString(36).slice(2)}`

// On macOS, Security.framework resolves the *default keychain* from a preferences plist under
// $HOME (~/Library/Preferences/com.apple.security.plist), not from the real login session — so
// overriding HOME above (needed to keep this test off the real ~/.claude.json) leaves the fake
// HOME with no default keychain and every keystore call fails with "A default keychain could not
// be found". Give the fake HOME its own throwaway keychain and point that same preferences plist
// at it, so the keystore round trip below exercises a real (but disposable) macOS keychain.
let darwinKeychain = null
if (process.platform === 'darwin') {
  darwinKeychain = path.join(home, 'Library', 'Keychains', 'itest.keychain-db')
  const prefsDir = path.join(home, 'Library', 'Preferences')
  fs.mkdirSync(prefsDir, { recursive: true })
  fs.mkdirSync(path.dirname(darwinKeychain), { recursive: true })
  const kcPassword = Math.random().toString(36).slice(2)
  const create = spawnSync('security', ['create-keychain', '-p', kcPassword, darwinKeychain])
  if (create.status !== 0) fail(`security create-keychain failed: ${create.stderr}`)
  spawnSync('security', ['set-keychain-settings', darwinKeychain])
  spawnSync('security', ['unlock-keychain', '-p', kcPassword, darwinKeychain])
  const guid = '{87191ca3-0fc9-11d4-849a-000502b52122}'
  const entry = (kind) =>
    `<dict><key>DbName</key><string>${darwinKeychain}</string><key>GUID</key><string>${guid}</string><key>SubserviceType</key><integer>6</integer></dict>`
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>DefaultKeychain</key><array>${entry()}</array>
<key>DLDBSearchList</key><array>${entry()}</array>
</dict></plist>`
  fs.writeFileSync(path.join(prefsDir, 'com.apple.security.plist'), plist)
}

function run(args, opts = {}) {
  return spawnSync('node', [cliPath, ...args], { env, encoding: 'utf8', ...opts })
}

function cleanup() {
  if (darwinKeychain) spawnSync('security', ['delete-keychain', darwinKeychain])
  fs.rmSync(home, { recursive: true, force: true })
}

function fail(msg) {
  console.error(`INTEGRATION FAIL: ${msg}`)
  cleanup()
  process.exit(1)
}

// 1. `add` is interactive by design (requireTTY gates it) and there is no test hook against
//    the release bundle, so a piped subprocess can never drive it here. Instead seed the real
//    OS keystore and store.json directly, byte-for-byte what `add` itself would write, so steps
//    2+ still exercise a genuine round trip through the real keystore via dist/cli.js.
const configDir = process.platform === 'win32' ? path.join(appData, 'claudefob') : path.join(xdg, 'claudefob')
fs.mkdirSync(configDir, { recursive: true })
// This process's own env, not just the subprocess env, must point at the fake home — the
// keystore write below runs in-process, and @napi-rs/keyring resolves the OS keystore from the
// live environment at call time (on macOS, from $HOME's keychain preferences plist above).
process.env.HOME = env.HOME
process.env.USERPROFILE = env.USERPROFILE
process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME
process.env.APPDATA = env.APPDATA
const { Entry } = require('@napi-rs/keyring')
new Entry('claudefob', tokenName).setPassword(tokenValue)
const seededStore = {
  version: 1,
  active: null,
  tokens: [
    {
      name: tokenName,
      description: 'integration',
      createdAt: new Date().toISOString(),
      last4: tokenValue.slice(-4),
    },
  ],
}
fs.writeFileSync(path.join(configDir, 'store.json'), JSON.stringify(seededStore), { mode: 0o600 })

const listRes = run(['list'])
if (listRes.status !== 0) fail(`list exited ${listRes.status}: ${listRes.stderr}`)
if (!listRes.stderr.includes(tokenName)) fail(`list did not show the seeded token: ${listRes.stderr}`)

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
  const psUseRes = run(['use', tokenName, '--shell', 'powershell'])
  if (psUseRes.status !== 0) fail(`use --shell powershell exited ${psUseRes.status}: ${psUseRes.stderr}`)
  const psScript = `${psUseRes.stdout.trim()}\nWrite-Output "RESULT=$env:CLAUDE_CODE_OAUTH_TOKEN"`
  const res = spawnSync('pwsh', ['-Command', psScript], { env, encoding: 'utf8' })
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

cleanup()
console.log('INTEGRATION OK')
