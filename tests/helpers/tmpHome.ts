import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TmpHome {
  home: string
  configHome: string
  fakeKeystorePath: string
  cleanup(): void
}

export function makeTmpHome(): TmpHome {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudefob-test-'))
  const configHome = path.join(home, '.config')
  fs.mkdirSync(configHome, { recursive: true })
  return {
    home,
    configHome,
    fakeKeystorePath: path.join(home, 'fake-keystore.json'),
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true })
    },
  }
}
