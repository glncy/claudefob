import os from 'node:os'
import path from 'node:path'
import type { ShellDialect } from './shell/index.ts'

export function configDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    const appData = env.APPDATA
    if (appData) return path.join(appData, 'claudefob')
    return path.join(os.homedir(), 'AppData', 'Roaming', 'claudefob')
  }
  const xdg = env.XDG_CONFIG_HOME
  if (xdg) return path.join(xdg, 'claudefob')
  return path.join(os.homedir(), '.config', 'claudefob')
}

export function storePath(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string {
  return path.join(configDir(env, platform), 'store.json')
}

/** Where claudefob keeps the sourceable hook script it owns (never a user dotfile). */
export function hookScriptPath(
  dialect: 'posix' | 'fish' | 'powershell',
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): string {
  const ext = dialect === 'fish' ? 'fish' : dialect === 'powershell' ? 'ps1' : 'sh'
  return path.join(configDir(env, platform), `hook.${ext}`)
}

export function claudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

export interface RcCandidate {
  path: string
  shell: ShellDialect
  note: string
}

export function rcCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): RcCandidate[] {
  const home = os.homedir()
  const list: RcCandidate[] = [
    { path: path.join(home, '.zshrc'), shell: 'posix', note: 'zsh interactive shells' },
    { path: path.join(home, '.zprofile'), shell: 'posix', note: 'zsh login shells' },
    { path: path.join(home, '.zshenv'), shell: 'posix', note: 'every zsh invocation' },
    { path: path.join(home, '.bashrc'), shell: 'posix', note: 'bash interactive shells' },
    { path: path.join(home, '.bash_profile'), shell: 'posix', note: 'bash login shells' },
    { path: path.join(home, '.profile'), shell: 'posix', note: 'sh-compatible login shells' },
    { path: path.join(home, '.config', 'fish', 'config.fish'), shell: 'fish', note: 'fish shells' },
  ]
  if (platform === 'win32') {
    const pp = powershellProfilePaths(env)
    list.push({ path: pp.ps51, shell: 'powershell', note: 'Windows PowerShell 5.1' })
    list.push({ path: pp.ps7, shell: 'powershell', note: 'PowerShell 7+' })
  }
  return list
}

export function powershellProfilePaths(env: NodeJS.ProcessEnv = process.env): { ps51: string; ps7: string } {
  const docs = env.USERPROFILE ? path.join(env.USERPROFILE, 'Documents') : path.join(os.homedir(), 'Documents')
  return {
    ps51: path.join(docs, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ps7: path.join(docs, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
  }
}
