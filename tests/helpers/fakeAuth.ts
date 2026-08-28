import type { AuthBackend } from '../../src/auth/types.ts'

export function fakeAuthBackend(result: boolean | (() => Promise<boolean>)): AuthBackend {
  return {
    id: 'test-fake',
    describe() {
      return 'test fake'
    },
    async challenge() {
      return typeof result === 'function' ? await result() : result
    },
  }
}
