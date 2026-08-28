import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { configDir } from './paths.ts'
import { err } from './ui/out.ts'
import { colors } from './ui/colors.ts'

export const PKG_NAME = 'claudefob'
const TTL_MS = 24 * 60 * 60 * 1000
const REGISTRY = 'https://registry.npmjs.org/claudefob/latest'

export interface UpdateCache {
  lastCheck: string
  latest: string
}

export function cachePath(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string {
  return path.join(configDir(env, platform), 'update-check.json')
}

/** Plain major.minor.patch comparison. A prerelease on either side is never an update. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const l = parse(latest)
  const c = parse(current)
  if (!l || !c) return false
  for (let i = 0; i < 3; i++) {
    const a = l[i] ?? 0
    const b = c[i] ?? 0
    if (a !== b) return a > b
  }
  return false
}

/**
 * ADDENDUM A3 — the update check must never run on the shell-startup path, never block, and never
 * fire in non-interactive or scripted contexts.
 */
export function shouldCheck(opts: { command: string; json: boolean }, env: NodeJS.ProcessEnv = process.env): boolean {
  if (opts.command === 'export') return false
  if (opts.json) return false
  if (env.CLAUDEFOB_NO_UPDATE_CHECK === '1') return false
  if (env.NO_UPDATE_NOTIFIER) return false
  if (env.CI) return false
  if (!process.stderr.isTTY) return false
  return true
}

export function readCache(): UpdateCache | null {
  try {
    const raw = fs.readFileSync(cachePath(), 'utf8')
    const parsed = JSON.parse(raw) as UpdateCache
    if (typeof parsed.latest !== 'string' || typeof parsed.lastCheck !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function writeCache(c: UpdateCache): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(cachePath(), JSON.stringify(c) + '\n', { mode: 0o600 })
  } catch {
    // a failed cache write must never affect the command
  }
}

export function isStale(cache: UpdateCache | null, now: number): boolean {
  if (!cache) return true
  const t = Date.parse(cache.lastCheck)
  if (Number.isNaN(t)) return true
  return now - t > TTL_MS
}

/** Fetches the registry and writes the cache. Used by the detached probe process. */
export async function probe(currentIso: string): Promise<void> {
  try {
    const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return
    const body = (await res.json()) as { version?: string }
    if (typeof body.version !== 'string') return
    writeCache({ lastCheck: currentIso, latest: body.version })
  } catch {
    // silent by design
  }
}

/** Spawns a detached, unref'd child to refresh the cache. Parent never waits. */
export function scheduleBackgroundProbe(): void {
  try {
    const entry = process.argv[1]
    if (!entry) return
    const child = spawn(process.execPath, [entry, '__update-probe'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CLAUDEFOB_PROBE: '1' },
    })
    child.unref()
  } catch {
    // never affects the command
  }
}

/**
 * Prints the notice from cache, then refreshes in the background if stale.
 * Always synchronous and non-blocking from the caller's perspective.
 */
export function maybeNotifyUpdate(currentVersion: string, opts: { command: string; json: boolean }): void {
  if (!shouldCheck(opts)) return
  const cache = readCache()
  if (cache && isNewer(cache.latest, currentVersion)) {
    err('')
    err(`  ${colors.bold('Update available')}  ${currentVersion} → ${cache.latest}`)
    err('  Run: claudefob update')
  }
  if (isStale(cache, Date.now())) scheduleBackgroundProbe()
}

export type InstallMethod = 'npm' | 'bun' | 'pnpm' | 'yarn' | 'homebrew' | 'unknown'

/** Best-effort detection of how the running binary was installed, from its resolved path. */
export function detectInstallMethod(entry: string | undefined = process.argv[1]): InstallMethod {
  if (!entry) return 'unknown'
  let p = entry
  try {
    p = fs.realpathSync(entry)
  } catch {
    // use the unresolved path
  }
  const n = p.replace(/\\/g, '/').toLowerCase()
  if (n.includes('/homebrew/') || n.includes('/cellar/')) return 'homebrew'
  if (n.includes('/.bun/')) return 'bun'
  if (n.includes('/pnpm/') || n.includes('/.pnpm/')) return 'pnpm'
  if (n.includes('/yarn/') || n.includes('/.yarn/')) return 'yarn'
  if (n.includes('/node_modules/')) return 'npm'
  return 'unknown'
}

export function updateCommandFor(m: InstallMethod): string {
  switch (m) {
    case 'bun':
      return 'bun add -g claudefob@latest'
    case 'pnpm':
      return 'pnpm add -g claudefob@latest'
    case 'yarn':
      return 'yarn global add claudefob@latest'
    case 'homebrew':
      return 'brew upgrade claudefob'
    default:
      return 'npm install -g claudefob@latest'
  }
}
