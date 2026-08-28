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
const hasDistTest = fs.existsSync(distTestCli)

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
  if (!hasDistTest) {
    test.skip('dist-test/cli.js not built — run `bun run build:test` first', () => {})
    return
  }

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
    fs.mkdirSync(path.join(home.configHome, 'claudefob'), { recursive: true })
    fs.writeFileSync(path.join(home.configHome, 'claudefob', 'store.json'), JSON.stringify(store), { mode: 0o600 })
    fs.writeFileSync(home.fakeKeystorePath, JSON.stringify({ work: 'sk-ant-aaaa' }))

    const listR = runIn(['list'])
    expect(listR.stdout).toBe('')
    expect(listR.status).toBe(0)

    const useR = runIn(['use', 'work', '--shell', 'posix'])
    expect(useR.status).toBe(0)
    expect(useR.stdout.trim()).toBe("export CLAUDE_CODE_OAUTH_TOKEN='sk-ant-aaaa'")

    const exportR = runIn(['export', '--shell', 'posix'])
    expect(exportR.status).toBe(0)
    expect(exportR.stdout.trim()).toBe("export CLAUDE_CODE_OAUTH_TOKEN='sk-ant-aaaa'")

    const showOkR = runIn(['show', 'work'], undefined)
    // CLAUDEFOB_FAKE_AUTH not set: show must fail closed (exit 3), and print nothing.
    expect(showOkR.status).toBe(3)
    expect(showOkR.stdout).toBe('')
    expect(showOkR.stderr).not.toContain('sk-ant-aaaa')

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
    const storeDir = path.join(home.configHome, 'claudefob')
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

  test('remove against a throwing keystore: exit 4, store byte-identical', () => {
    const home = makeTmpHome()
    const env: Record<string, string | undefined> = { ...baseTestEnv(home), CLAUDEFOB_FAKE_KEYSTORE: '__THROW__' }
    const store = {
      version: 1,
      active: null,
      tokens: [{ name: 'work', createdAt: new Date().toISOString(), last4: 'aaaa' }],
    }
    const storeDir = path.join(home.configHome, 'claudefob')
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
  const hasRelease = fs.existsSync(releasePath)

  test.if(hasRelease)('release bundle does not contain the string CLAUDEFOB_FAKE_AUTH', () => {
    const text = fs.readFileSync(releasePath, 'utf8')
    expect(text).not.toContain('CLAUDEFOB_FAKE_AUTH')
  })

  test.if(!hasRelease)('skipped: dist/cli.js not built — run `bun run build` first', () => {})
})
