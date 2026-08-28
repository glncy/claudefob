import { execFileSync } from 'node:child_process'
import { UsageError } from '../ui/errors.ts'
import { posixCodegen } from './posix.ts'
import { fishCodegen } from './fish.ts'
import { powershellCodegen } from './powershell.ts'

export type ShellDialect = 'posix' | 'fish' | 'powershell'

export interface ShellCodegen {
  id: ShellDialect
  setEnv(name: string, value: string): string
  unsetEnv(name: string): string
  quote(value: string): string
  hookBlock(): string
}

export function codegenFor(d: ShellDialect): ShellCodegen {
  switch (d) {
    case 'posix':
      return posixCodegen
    case 'fish':
      return fishCodegen
    case 'powershell':
      return powershellCodegen
  }
}

export function parentProcessName(): string | undefined {
  if (process.platform === 'win32') return undefined
  try {
    const ppid = process.ppid
    if (!ppid) return undefined
    const out = execFileSync('ps', ['-o', 'comm=', '-p', String(ppid)], { encoding: 'utf8' }).trim()
    if (!out) return undefined
    return out.split('/').pop()
  } catch {
    return undefined
  }
}

/** Pure detection logic, given an already-resolved parent process name (or undefined). */
export function resolveShellDialect(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  parentName: string | undefined,
): ShellDialect {
  if (parentName) {
    const base = parentName.toLowerCase()
    if (base.includes('fish')) return 'fish'
    if (base.includes('pwsh') || base.includes('powershell')) return 'powershell'
    if (base.includes('zsh') || base.includes('bash') || base === 'sh' || base.includes('/sh')) return 'posix'
  }
  const shellEnv = env.SHELL
  if (shellEnv) {
    const base = shellEnv.split(/[\\/]/).pop()?.toLowerCase() ?? ''
    if (base.includes('fish')) return 'fish'
    if (base.includes('zsh') || base.includes('bash') || base === 'sh') return 'posix'
  }
  if (platform === 'win32') {
    return env.MSYSTEM ? 'posix' : 'powershell'
  }
  return 'posix'
}

function safeParentProcessName(): string | undefined {
  try {
    return parentProcessName()
  } catch {
    return undefined
  }
}

/** Live detection: probes the parent process unless a name is explicitly supplied. */
export function detectShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  parentName?: string,
): ShellDialect {
  return resolveShellDialect(env, platform, arguments.length >= 3 ? parentName : safeParentProcessName())
}

export function parseShellFlag(raw: string): ShellDialect {
  if (raw === 'posix' || raw === 'fish' || raw === 'powershell') return raw
  if (raw === 'cmd') {
    throw new UsageError(
      "cmd.exe is not supported: it has no profile mechanism (only the invasive AutoRun registry key) " +
        'and no command substitution. Use PowerShell instead: claudefob init --shell powershell',
    )
  }
  throw new UsageError(`Unknown shell '${raw}'. Expected one of: posix, fish, powershell.`)
}
