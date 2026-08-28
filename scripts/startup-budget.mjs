// ADDENDUM A5: `claudefob export` runs on every new terminal. Measure our overhead ABOVE the
// runtime's own startup, so the assertion holds on slow CI runners where absolute numbers vary.
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CLI = path.join(process.cwd(), 'dist', 'cli.js')
const RUNS = 9
const BUDGET_MS = 100

const home = mkdtempSync(path.join(tmpdir(), 'claudefob-bench-'))
const env = { ...process.env, XDG_CONFIG_HOME: home, APPDATA: home, CLAUDEFOB_NO_UPDATE_CHECK: '1' }

// The minimum, not the median: it reflects the true cost of the work, and is immune to a runner
// pausing mid-sample. A Windows run once measured 412ms against a 47ms median for the same commit
// minutes earlier — noise, not a regression.
function best(xs) {
  return Math.min(...xs)
}

function time(args) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint()
    const r = spawnSync(process.execPath, args, { env, stdio: 'ignore' })
    const t1 = process.hrtime.bigint()
    if (r.status !== 0) throw new Error(`command failed: ${args.join(' ')} (exit ${r.status})`)
    runs.push(Number(t1 - t0) / 1e6)
  }
  return best(runs)
}

const baseline = time(['-e', ''])
const withCli = time([CLI, 'export', '--shell', 'posix'])
const overhead = withCli - baseline

console.log(`runtime baseline: ${baseline.toFixed(1)}ms (best of ${RUNS})`)
console.log(`claudefob export: ${withCli.toFixed(1)}ms`)
console.log(`overhead:         ${overhead.toFixed(1)}ms (budget ${BUDGET_MS}ms)`)

if (overhead > BUDGET_MS) {
  console.error(`FAIL: startup overhead ${overhead.toFixed(1)}ms exceeds the ${BUDGET_MS}ms budget.`)
  console.error('The no-active-token path must not load @napi-rs/keyring or any other native module.')
  process.exit(1)
}
console.log('OK')
