import { describe, expect, test, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { makeTmpHome, baseTestEnv } from './helpers/tmpHome.ts'

const repoRoot = path.join(import.meta.dir, '..')
const distTestCli = path.join(repoRoot, 'dist-test', 'cli.js')

// `bun test` alone (without an explicit `bun run build:test` first) must still be able to drive
// the subprocess suite: build the test bundle on demand if it isn't there yet.
if (!fs.existsSync(distTestCli)) {
  spawnSync('bun', ['run', 'build:test'], { cwd: repoRoot, stdio: 'ignore' })
}
if (!fs.existsSync(distTestCli)) {
  // Fail loudly rather than skipping: a silently skipped subprocess suite reads as "passing".
  throw new Error('dist-test/cli.js is missing and `bun run build:test` did not produce it')
}

function run(args: string[], opts: { env?: Record<string, string | undefined>; input?: string } = {}) {
  const home = makeTmpHome()
  const env: Record<string, string | undefined> = baseTestEnv(home)
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  const res = spawnSync('node', [distTestCli, ...args], {
    env,
    input: opts.input,
    encoding: 'utf8',
  })
  return { ...res, home }
}

describe('stdout/stderr discipline over a real subprocess', () => {
  test('list on an empty store: empty stdout', () => {
    const r = run(['list'])
    expect(r.stdout).toBe('')
    expect(r.status).toBe(0)
    r.home.cleanup()
  })

  test('status when inactive: empty stdout, exit 1', () => {
    const r = run(['status'])
    expect(r.stdout).toBe('')
    expect(r.status).toBe(1)
    r.home.cleanup()
  })

  test('guide: empty stdout', () => {
    const r = run(['guide', '--shell', 'posix'])
    expect(r.stdout).toBe('')
    expect(r.status).toBe(0)
    r.home.cleanup()
  })

  test('init: stdout contains only shell code (the hook block)', () => {
    const r = run(['init', '--shell', 'posix'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('# >>> claudefob >>>')
    expect(r.stdout).toContain('# <<< claudefob <<<')
    // every non-empty stdout line must be shell code, not human prose
    expect(r.stdout).not.toContain('Append the following')
    r.home.cleanup()
  })

  test('init pads the block with blank lines so `>>` never jams it onto existing content', () => {
    const r = run(['init', '--shell', 'posix'])
    expect(r.status).toBe(0)
    expect(r.stdout.startsWith('\n# >>> claudefob >>>')).toBe(true)
    // Exactly one trailing newline, not a blank line: padding both sides made repeated
    // `claudefob init >> rc` runs stack blank lines in the file.
    expect(r.stdout.endsWith('# <<< claudefob <<<\n')).toBe(true)
    expect(r.stdout.endsWith('\n\n')).toBe(false)
    r.home.cleanup()
  })

  test('appending init twice yields exactly one blank line between blocks', () => {
    const r1 = run(['init', '--shell', 'posix'])
    const r2 = run(['init', '--shell', 'posix'])
    const combined = 'existing line\n' + r1.stdout + r2.stdout
    expect(combined).not.toContain('\n\n\n')
    r1.home.cleanup()
    r2.home.cleanup()
  })

  test('init writes the hook script and emits only a source line', () => {
    const r = run(['init', '--shell', 'posix'])
    const script = path.join(r.home.storeDir, 'claudefob', 'hook.sh')
    expect(fs.existsSync(script)).toBe(true)
    // The rc file gets three lines; the ~50-line block lives in the script instead.
    expect(r.stdout.trim().split('\n')).toHaveLength(3)
    expect(r.stdout).toContain(script)
    expect(fs.readFileSync(script, 'utf8')).toContain('_claudefob_sync')
    r.home.cleanup()
  })

  test('init tells you how to activate the current shell without a new terminal', () => {
    const r = run(['init', '--shell', 'posix'])
    const script = path.join(r.home.storeDir, 'claudefob', 'hook.sh')
    expect(r.stderr).toContain('To activate it in THIS terminal')
    expect(r.stderr).toContain(`. '${script}'`)
    // The instruction is guidance, so it must not land on stdout and get appended to an rc file.
    expect(r.stdout).not.toContain('THIS terminal')
    r.home.cleanup()
  })

  test('init --inline emits the full block and writes no script', () => {
    const r = run(['init', '--shell', 'posix', '--inline'])
    const script = path.join(r.home.storeDir, 'claudefob', 'hook.sh')
    expect(fs.existsSync(script)).toBe(false)
    expect(r.stdout).toContain('_claudefob_sync')
    expect(r.stdout.trim().split('\n').length).toBeGreaterThan(20)
    r.home.cleanup()
  })

  test('export with nothing active: exit 0, empty stdout', () => {
    const r = run(['export', '--shell', 'posix'])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    r.home.cleanup()
  })

  test('use on unknown name: exit 2, empty stdout', () => {
    const r = run(['use', 'nope', '--shell', 'posix'])
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    r.home.cleanup()
  })

  test('stop when nothing active: idempotent, emits unset on stdout, exit 0', () => {
    const r = run(['stop', '--shell', 'posix'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('unset CLAUDE_CODE_OAUTH_TOKEN')
    r.home.cleanup()
  })

  test('full add -> use -> show -> export -> stop cycle via the fake keystore/auth seams', () => {
    const home = makeTmpHome()
    const env: Record<string, string | undefined> = baseTestEnv(home)
    const runIn = (args: string[], input?: string) =>
      spawnSync('node', [distTestCli, ...args], { env, input, encoding: 'utf8' })

    // add is interactive (password prompt) and requires a TTY, which a piped subprocess does not
    // have; seed the store + fake keystore directly instead, mirroring what `add` would produce.
    const store = {
      version: 1,
      active: null,
      tokens: [{ name: 'work', description: 'day job', createdAt: new Date().toISOString(), last4: 'aaaa' }],
    }
    fs.mkdirSync(path.join(home.storeDir, 'claudefob'), { recursive: true })
    fs.writeFileSync(path.join(home.storeDir, 'claudefob', 'store.json'), JSON.stringify(store), { mode: 0o600 })
    fs.writeFileSync(home.fakeKeystorePath, JSON.stringify({ work: 'sk-ant-aaaa' }))

    const listR = runIn(['list'])
    expect(listR.stdout).toBe('')
    expect(listR.status).toBe(0)

    const useR = runIn(['use', 'work', '--shell', 'posix'])
    expect(useR.status).toBe(0)
    expect(useR.stdout.trim().split('\n')[0]).toBe("export CLAUDE_CODE_OAUTH_TOKEN='sk-ant-aaaa'")

    const exportR = runIn(['export', '--shell', 'posix'])
    expect(exportR.status).toBe(0)
    expect(exportR.stdout.trim().split('\n')[0]).toBe("export CLAUDE_CODE_OAUTH_TOKEN='sk-ant-aaaa'")

    // Deterministic fail-closed check: a backend that denies must yield exit 3 and print nothing.
    const showDeniedR = spawnSync(
      'node',
      [distTestCli, 'show', 'work'],
      { env: { ...env, CLAUDEFOB_FAKE_AUTH: '1', CLAUDEFOB_FAKE_AUTH_RESULT: 'fail' }, encoding: 'utf8' },
    )
    expect(showDeniedR.status).toBe(3)
    expect(showDeniedR.stdout).toBe('')
    expect(showDeniedR.stderr).not.toContain('sk-ant-aaaa')

    // Deliberately NOT exercising the real auth backend here: on Windows it opens a modal
    // credential dialog that never returns in a headless runner, and on GitHub's macOS runners
    // passwordless sudo makes its outcome environment-dependent. The release bundle's freedom
    // from the fake seam is proven separately by the string-absence test below.

    const showFakeAuthR = spawnSync(
      'node',
      [distTestCli, 'show', 'work'],
      { env: { ...env, CLAUDEFOB_FAKE_AUTH: '1' }, encoding: 'utf8' },
    )
    expect(showFakeAuthR.status).toBe(0)
    expect(showFakeAuthR.stdout).toBe('')
    expect(showFakeAuthR.stderr).toContain('sk-ant-aaaa')

    const stopR = runIn(['stop', '--shell', 'posix'])
    expect(stopR.status).toBe(0)
    expect(stopR.stdout.trim()).toBe('unset CLAUDE_CODE_OAUTH_TOKEN')

    home.cleanup()
  })

  test('use on a record whose secret is missing from the keystore: exit 4, store/claude.json byte-identical', () => {
    const home = makeTmpHome()
    const env: Record<string, string | undefined> = baseTestEnv(home)
    const store = {
      version: 1,
      active: null,
      tokens: [{ name: 'ghost', createdAt: new Date().toISOString(), last4: 'aaaa' }],
    }
    const storeDir = path.join(home.storeDir, 'claudefob')
    fs.mkdirSync(storeDir, { recursive: true })
    const storePath = path.join(storeDir, 'store.json')
    fs.writeFileSync(storePath, JSON.stringify(store), { mode: 0o600 })
    fs.writeFileSync(home.fakeKeystorePath, JSON.stringify({})) // secret absent: drift

    const claudeJsonPath = path.join(home.home, '.claude.json')
    fs.writeFileSync(claudeJsonPath, '{"hasCompletedOnboarding": false}')

    const before = { store: fs.readFileSync(storePath, 'utf8'), claude: fs.readFileSync(claudeJsonPath, 'utf8') }

    const r = spawnSync('node', [distTestCli, 'use', 'ghost', '--shell', 'posix'], { env, encoding: 'utf8' })
    expect(r.status).toBe(4)
    expect(r.stdout).toBe('')

    const after = { store: fs.readFileSync(storePath, 'utf8'), claude: fs.readFileSync(claudeJsonPath, 'utf8') }
    expect(after.store).toBe(before.store)
    expect(after.claude).toBe(before.claude)

    home.cleanup()
  })

  test('use against a throwing (not merely empty) keystore: exit 4, no "remove and re-add" drift advice', () => {
    // Regression: realKeystore.get() used to convert *every* getPassword() failure (locked
    // keystore, dead D-Bus, access denied) into null='missing', so `use` printed "Try
    // `claudefob remove x` and re-add it" even when the secret was never actually missing —
    // just transiently unreachable. CLAUDEFOB_FAKE_KEYSTORE=__THROW__ simulates that transient
    // failure; the fix must surface it as a keystore-unavailable error, not a "missing" one.
    const home = makeTmpHome()
    const env: Record<string, string | undefined> = { ...baseTestEnv(home), CLAUDEFOB_FAKE_KEYSTORE: '__THROW__' }
    const store = {
      version: 1,
      active: null,
      tokens: [{ name: 'work', createdAt: new Date().toISOString(), last4: 'aaaa' }],
    }
    const storeDir = path.join(home.storeDir, 'claudefob')
    fs.mkdirSync(storeDir, { recursive: true })
    fs.writeFileSync(path.join(storeDir, 'store.json'), JSON.stringify(store), { mode: 0o600 })

    const r = spawnSync('node', [distTestCli, 'use', 'work', '--shell', 'posix'], { env, encoding: 'utf8' })
    expect(r.status).toBe(4)
    expect(r.stdout).toBe('')
    expect(r.stderr).not.toContain('remove')

    home.cleanup()
  })

  test('list is metadata-only: never touches the keystore, even a throwing one, and prints no drift marker', () => {
    // Regression: list used to call keystore.get() per token to compute a "⚠ missing" marker,
    // contradicting SPEC §2/§4.2 ("metadata only — no keystore read"). With a keystore
    // configured to throw on every call, list must still succeed.
    const home = makeTmpHome()
    const env: Record<string, string | undefined> = { ...baseTestEnv(home), CLAUDEFOB_FAKE_KEYSTORE: '__THROW__' }
    const store = {
      version: 1,
      active: null,
      tokens: [{ name: 'work', createdAt: new Date().toISOString(), last4: 'aaaa' }],
    }
    const storeDir = path.join(home.storeDir, 'claudefob')
    fs.mkdirSync(storeDir, { recursive: true })
    fs.writeFileSync(path.join(storeDir, 'store.json'), JSON.stringify(store), { mode: 0o600 })

    const r = spawnSync('node', [distTestCli, 'list', '--json'], { env, encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    const parsed = JSON.parse(r.stderr)
    expect(parsed.tokens).toHaveLength(1)
    expect(parsed.tokens[0]).not.toHaveProperty('missing')

    home.cleanup()
  })

  test('status: env var set but nothing active reports "stale", not "inactive" (SPEC §4.4)', () => {
    const home = makeTmpHome()
    const env: Record<string, string | undefined> = {
      ...baseTestEnv(home),
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-leftover',
    }
    const r = spawnSync('node', [distTestCli, 'status', '--json'], { env, encoding: 'utf8' })
    const parsed = JSON.parse(r.stderr)
    expect(parsed.active).toBe(null)
    expect(parsed.thisShell).toBe('stale')

    home.cleanup()
  })

  test('remove against a throwing keystore: exit 4, store byte-identical', () => {
    const home = makeTmpHome()
    const env: Record<string, string | undefined> = { ...baseTestEnv(home), CLAUDEFOB_FAKE_KEYSTORE: '__THROW__' }
    const store = {
      version: 1,
      active: null,
      tokens: [{ name: 'work', createdAt: new Date().toISOString(), last4: 'aaaa' }],
    }
    const storeDir = path.join(home.storeDir, 'claudefob')
    fs.mkdirSync(storeDir, { recursive: true })
    const storePath = path.join(storeDir, 'store.json')
    fs.writeFileSync(storePath, JSON.stringify(store), { mode: 0o600 })
    const before = fs.readFileSync(storePath, 'utf8')

    const r = spawnSync('node', [distTestCli, 'remove', 'work', '--yes', '--shell', 'posix'], { env, encoding: 'utf8' })
    expect(r.status).toBe(4)

    const after = fs.readFileSync(storePath, 'utf8')
    expect(after).toBe(before)

    home.cleanup()
  })
})

describe('CLAUDEFOB_FAKE_AUTH is inert against unbuilt source and the release bundle', () => {
  const releasePath = path.join(repoRoot, 'dist', 'cli.js')
  if (!fs.existsSync(releasePath)) {
    spawnSync('bun', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' })
  }
  if (!fs.existsSync(releasePath)) {
    throw new Error('dist/cli.js is missing and `bun run build` did not produce it')
  }

  test('release bundle does not contain the string CLAUDEFOB_FAKE_AUTH', () => {
    const text = fs.readFileSync(releasePath, 'utf8')
    expect(text).not.toContain('CLAUDEFOB_FAKE_AUTH')
  })
})
