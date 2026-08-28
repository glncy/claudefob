import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TmpHome {
  home: string
  configHome: string
  appDataHome: string
  fakeKeystorePath: string
  /** Where paths.ts will actually look for store.json on THIS platform. */
  storeDir: string
  cleanup(): void
}

export function makeTmpHome(): TmpHome {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudefob-test-'))
  const configHome = path.join(home, '.config')
  const appDataHome = path.join(home, 'AppData', 'Roaming')
  fs.mkdirSync(configHome, { recursive: true })
  fs.mkdirSync(appDataHome, { recursive: true })
  return {
    home,
    configHome,
    appDataHome,
    // paths.ts resolves the config dir from APPDATA on win32 and XDG_CONFIG_HOME elsewhere.
    // Seeding a store into the wrong one silently produced "no such token" on Windows only.
    storeDir: process.platform === 'win32' ? appDataHome : configHome,
    fakeKeystorePath: path.join(home, 'fake-keystore.json'),
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true })
    },
  }
}

// Base subprocess env for tests that isolate a tmp home. Every var that paths.ts or
// os.homedir() consult on *some* platform is overridden — HOME/XDG_CONFIG_HOME on posix,
// APPDATA/USERPROFILE on win32 — so the suite is isolated identically on every OS, and the
// Windows-critical vars a child node process needs to even start are inherited rather than
// dropped (building the env from an empty object left those absent on windows-latest).
export function baseTestEnv(home: TmpHome): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home.home,
    USERPROFILE: home.home,
    XDG_CONFIG_HOME: home.configHome,
    APPDATA: home.appDataHome,
    SystemRoot: process.env.SystemRoot,
    PATHEXT: process.env.PATHEXT,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    CLAUDEFOB_FAKE_KEYSTORE: home.fakeKeystorePath,
  }
}
