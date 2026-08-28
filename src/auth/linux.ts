import { spawnSync } from 'node:child_process'
import { AuthUnavailableError, type AuthBackend } from './types.ts'

export type LinuxMethod = 'pkexec' | 'sudo' | 'none'

/**
 * pkexec needs a polkit authentication agent. A desktop session has one; a headless box reached
 * over SSH does not, so pkexec fails instantly and the user sees "authentication failed" when the
 * truth is that nothing could have asked them. sudo prompts on the TTY and works there.
 */
export function chooseLinuxMethod(
  env: NodeJS.ProcessEnv = process.env,
  has: (bin: string) => boolean = (bin) => spawnSync('which', [bin], { stdio: 'ignore' }).status === 0,
): LinuxMethod {
  const graphical = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
  if (graphical && has('pkexec')) return 'pkexec'
  if (has('sudo')) return 'sudo'
  if (has('pkexec')) return 'pkexec' // no agent expected, but better than refusing outright
  return 'none'
}

export function describeLinuxMethod(m: LinuxMethod): string {
  switch (m) {
    case 'pkexec':
      return 'pkexec (polkit, administrator password)'
    case 'sudo':
      return 'sudo (your login password)'
    default:
      return 'no authentication mechanism available'
  }
}

export function linuxBackend(
  method: LinuxMethod = chooseLinuxMethod(),
  run: (bin: string, args: string[]) => { status: number | null; error?: Error } = (bin, args) =>
    spawnSync(bin, args, { stdio: 'inherit' }),
  isTTY: () => boolean = () => Boolean(process.stdin.isTTY),
): AuthBackend {
  return {
    id: 'linux',
    describe() {
      return describeLinuxMethod(method)
    },
    async challenge(): Promise<boolean> {
      if (method === 'none') {
        throw new AuthUnavailableError(
          'No way to authenticate on this machine: neither sudo nor pkexec is installed.\n' +
            '  Inspect the keystore directly with seahorse, or with:\n' +
            '    secret-tool lookup service claudefob account <name>',
        )
      }
      // sudo prompts on the terminal, so a piped or detached stdin can never answer it. Say so
      // rather than letting it fail and read as a refusal.
      if (method === 'sudo' && !isTTY()) {
        throw new AuthUnavailableError(
          'Revealing a token needs an interactive terminal to enter your password.\n' +
            '  Run `claudefob show` directly in a terminal, or read the keystore with:\n' +
            '    secret-tool lookup service claudefob account <name>',
        )
      }
      // -k discards any cached sudo timestamp, so revealing a token always prompts.
      const [bin, args] = method === 'sudo' ? ['sudo', ['-k', '-v']] : ['pkexec', ['/bin/true']]
      const res = run(bin, args)
      if (res.error) {
        if ((res.error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new AuthUnavailableError(`${bin} is not installed.`)
        }
        throw new AuthUnavailableError(res.error.message)
      }
      return res.status === 0
    },
  }
}
