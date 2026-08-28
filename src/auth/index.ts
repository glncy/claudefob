import { darwinBackend } from './darwin.ts'
import { linuxBackend } from './linux.ts'
import { win32Backend } from './win32.ts'
import { AuthUnavailableError, type AuthBackend } from './types.ts'

export type { AuthBackend }
export { AuthUnavailableError }

declare const __CLAUDEFOB_TEST__: boolean | undefined

// Everything under `__CLAUDEFOB_TEST__ === true` — including the `CLAUDEFOB_FAKE_AUTH` string
// literal itself — must be provably dead in a release build. `bun build --define
// __CLAUDEFOB_TEST__=false` turns the flag into the literal `false`, which folds every branch
// below to `false && …` and lets the minifier tree-shake this whole block, function bodies
// included, out of dist/cli.js. Keeping the check as one inline expression (rather than split
// across two function calls) is what makes that constant-folding reliable.
export function isFakeAuthEnabled(): boolean {
  return typeof __CLAUDEFOB_TEST__ !== 'undefined' && __CLAUDEFOB_TEST__ === true && process.env.CLAUDEFOB_FAKE_AUTH === '1'
}

export function selectBackend(platform: NodeJS.Platform = process.platform): AuthBackend {
  if (typeof __CLAUDEFOB_TEST__ !== 'undefined' && __CLAUDEFOB_TEST__ === true && process.env.CLAUDEFOB_FAKE_AUTH === '1') {
    return {
      id: 'fake',
      describe: () => 'fake test backend',
      challenge: async () => process.env.CLAUDEFOB_FAKE_AUTH_RESULT !== 'fail',
    }
  }
  if (platform === 'darwin') return darwinBackend()
  if (platform === 'linux') return linuxBackend()
  if (platform === 'win32') return win32Backend()
  throw new AuthUnavailableError(`No authentication backend available for platform '${platform}'.`)
}
