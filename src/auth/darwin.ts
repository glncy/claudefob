import { execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import type { AuthBackend } from './types.ts'

export function isAdmin(user: string = os.userInfo().username): boolean {
  try {
    const out = execFileSync('id', ['-Gn', user], { encoding: 'utf8' })
    return out.split(/\s+/).includes('admin')
  } catch {
    try {
      execFileSync('dscl', ['.', '-read', '/Groups/admin', 'GroupMembership'], { encoding: 'utf8' })
      return false
    } catch {
      return false
    }
  }
}

export function darwinBackend(): AuthBackend {
  const admin = isAdmin()
  return {
    id: 'darwin',
    describe() {
      return admin ? 'sudo (Touch ID / password)' : 'dscl -authonly (password)'
    },
    async challenge(): Promise<boolean> {
      if (admin) {
        const res = spawnSync('sudo', ['-k', '-v'], { stdio: 'inherit' })
        return res.status === 0
      }
      const res = spawnSync('dscl', ['.', '-authonly', os.userInfo().username], { stdio: 'inherit' })
      return res.status === 0
    },
  }
}
