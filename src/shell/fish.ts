import type { ShellCodegen } from './index.ts'

function quote(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `'${escaped}'`
}

export const fishCodegen: ShellCodegen = {
  id: 'fish',
  quote,
  setEnv(name, value) {
    return `set -gx ${name} ${quote(value)}`
  },
  unsetEnv(name) {
    return `set -e ${name}`
  },
  hookBlock() {
    return [
      '# >>> claudefob >>>',
      'set -gx CLAUDEFOB_HOOK 1',
      'eval (command claudefob export --shell fish)',
      'function claudefob',
      '    set -l __cf_out (command claudefob $argv --shell fish)',
      '    or return $status',
      '    test -n "$__cf_out"; and eval $__cf_out',
      'end',
      '# <<< claudefob <<<',
    ].join('\n')
  },
}
