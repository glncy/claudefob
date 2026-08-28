import { describe, expect, test, afterEach, beforeEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { runExport } from '../src/export.ts'
import { emptyStore, saveStore, addToken, setActive } from '../src/store.ts'
import { storePath } from '../src/paths.ts'
import { __setKeystoreForTests } from '../src/keystore.ts'
import { throwingKeystore } from './helpers/fakeKeystore.ts'
import { makeTmpHome } from './helpers/tmpHome.ts'

function captureStdout(fn: () => void): string {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    fn()
  } finally {
    process.stdout.write = orig
  }
  return chunks.join('')
}

let home: ReturnType<typeof makeTmpHome>
let prevXdg: string | undefined
let prevAppData: string | undefined

beforeEach(() => {
  home = makeTmpHome()
  prevXdg = process.env.XDG_CONFIG_HOME
  prevAppData = process.env.APPDATA
  // Both must be redirected: paths.ts reads APPDATA on win32 and XDG_CONFIG_HOME elsewhere, so
  // setting only one left this in-process suite pointed at the real machine store on Windows.
  process.env.XDG_CONFIG_HOME = home.configHome
  process.env.APPDATA = home.appDataHome
})

afterEach(() => {
  __setKeystoreForTests(null)
  delete process.env.CLAUDEFOB_DEBUG
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = prevXdg
  if (prevAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = prevAppData
  home.cleanup()
})

describe('export fails silent (SPEC §4.11)', () => {
  test('missing store.json -> no output, no throw', () => {
    expect(fs.existsSync(storePath())).toBe(false)
    const out = captureStdout(() => runExport('posix'))
    expect(out).toBe('')
  })

  test('corrupt store.json -> no output, no throw', () => {
    const p = storePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, '{not json')
    const out = captureStdout(() => runExport('posix'))
    expect(out).toBe('')
  })

  test('nothing active -> no output', () => {
    saveStore(emptyStore(), storePath())
    const out = captureStdout(() => runExport('posix'))
    expect(out).toBe('')
  })

  test('keystore throws -> no output, no throw', () => {
    let store = addToken(emptyStore(), { name: 'work', createdAt: 'now', last4: 'aaaa' })
    store = setActive(store, 'work')
    saveStore(store, storePath())
    __setKeystoreForTests(throwingKeystore())
    const out = captureStdout(() => runExport('posix'))
    expect(out).toBe('')
  })

  test('active token with a working keystore emits exactly one line of shell code', () => {
    let store = addToken(emptyStore(), { name: 'work', createdAt: 'now', last4: 'aaaa' })
    store = setActive(store, 'work')
    saveStore(store, storePath())
    const { mapKeystore } = require('./helpers/fakeKeystore.ts') as typeof import('./helpers/fakeKeystore.ts')
    __setKeystoreForTests(mapKeystore({ work: 'sk-ant-aaaa' }))
    const out = captureStdout(() => runExport('posix'))
    expect(out).toBe("export CLAUDE_CODE_OAUTH_TOKEN='sk-ant-aaaa'\n")
  })
})
