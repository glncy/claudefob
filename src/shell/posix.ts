import type { ShellCodegen } from './index.ts'

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export const posixCodegen: ShellCodegen = {
  id: 'posix',
  quote,
  setEnv(name, value) {
    return `export ${name}=${quote(value)}`
  },
  unsetEnv(name) {
    return `unset ${name}`
  },
  hookBlock() {
    return [
      '# >>> claudefob >>>',
      'export CLAUDEFOB_HOOK=1',
      'eval "$(command claudefob export --shell posix)"',
      'claudefob() {',
      '  local __cf_out',
      '  __cf_out="$(command claudefob "$@" --shell posix)" || return $?',
      '  [ -n "$__cf_out" ] && eval "$__cf_out"',
      '}',
      '# <<< claudefob <<<',
    ].join('\n')
  },
}
