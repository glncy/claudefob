import { spawnSync } from 'node:child_process'
import { AuthUnavailableError, type AuthBackend } from './types.ts'

export function linuxBackend(): AuthBackend {
  return {
    id: 'linux',
    describe() {
      return 'pkexec (administrator password)'
    },
    async challenge(): Promise<boolean> {
      const res = spawnSync('pkexec', ['/bin/true'], { stdio: 'inherit' })
      if (res.error) {
        if ((res.error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new AuthUnavailableError(
            'pkexec is not installed. Install polkit, or use seahorse to inspect the keystore directly.',
          )
        }
        throw new AuthUnavailableError(res.error.message)
      }
      return res.status === 0
    },
  }
}
