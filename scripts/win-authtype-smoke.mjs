#!/usr/bin/env node
// Windows-only smoke test: compiles the Add-Type P/Invoke source used by src/auth/win32.ts
// without ever calling CredUIPromptForWindowsCredentials (no dialog, so it runs headless in CI).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (process.platform !== 'win32') {
  console.log('SKIP: not running on win32')
  process.exit(0)
}

// Imported (not duplicated) so this smoke test can never drift from the real source, unlike the
// previous copy here — which had gone stale and described non-compiling C#.
const { AUTH_TYPE_SOURCE } = await import('../src/auth/win32.ts')

// Only the `Add-Type ...` statement is compiled — everything after it in the real script builds
// the CREDUI_INFO struct instance and calls CredUIPromptForWindowsCredentials, which would pop
// the real dialog. Add-Type alone proves the P/Invoke signatures and the CREDUI_INFO struct are
// well-formed C# without ever reaching that call.
const addTypeEnd = AUTH_TYPE_SOURCE.indexOf('\n\n$credui')
if (addTypeEnd === -1) {
  console.error('Could not isolate the Add-Type statement from AUTH_TYPE_SOURCE — has win32.ts changed shape?')
  process.exit(1)
}
const addTypeOnly = AUTH_TYPE_SOURCE.slice(0, addTypeEnd) + '\nWrite-Output "OK"'

// Run from a temp .ps1 rather than piping into `-Command -`: on the CI runner the piped form
// exits 0 while producing no output at all, which is indistinguishable from a silent failure.
const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claudefob-smoke-')), 'smoke.ps1')
fs.writeFileSync(scriptPath, addTypeOnly, 'utf8')

const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
  encoding: 'utf8',
  timeout: 60_000,
})

if (res.status !== 0 || res.stdout.trim() !== 'OK') {
  console.error(`P/Invoke source failed to compile. status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`)
  process.exit(1)
}

console.log('WIN AUTHTYPE SMOKE OK')
