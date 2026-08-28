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
  sourceBlock(scriptPath) {
    return [
      '# >>> claudefob >>>',
      `test -f ${JSON.stringify(scriptPath)}; and source ${JSON.stringify(scriptPath)}`,
      '# <<< claudefob <<<',
    ].join('\n')
  },
  hookBlock() {
    return [
      '# >>> claudefob >>>',
      '# Degrade quietly when the binary is absent (uninstalled, or installed under a different',
      '# runtime version by a version manager).',
      'if command -v claudefob >/dev/null 2>&1',
      'set -gx CLAUDEFOB_HOOK 1',
      'eval (command claudefob export --shell fish)',
      '# Seed the sync marker at startup; see the posix block for why lazy creation misses a switch.',
      'touch /tmp/claudefob-sync-$fish_pid 2>/dev/null',
      'function claudefob',
      '    set -l __cf_out (command claudefob $argv --shell fish)',
      '    or return $status',
      '    test -n "$__cf_out"; and eval $__cf_out',
      'end',
      '',
      '# Keeps already-open terminals in step with a switch made elsewhere; runs claudefob only on',
      '# the first prompt after store.json actually changes.',
      '# fish_preexec as well as fish_prompt: without it the first command after a switch made in',
      '# another terminal still sees the old value.',
      'function _claudefob_sync --on-event fish_prompt --on-event fish_preexec',
      '    set -l __cf_store "$HOME/.config/claudefob/store.json"',
      '    test -n "$XDG_CONFIG_HOME"; and set __cf_store "$XDG_CONFIG_HOME/claudefob/store.json"',
      '    set -l __cf_marker /tmp/claudefob-sync-$fish_pid',
      '    if not test -e "$__cf_marker"',
      '        touch "$__cf_marker" 2>/dev/null',
      '    else',
      '        test "$__cf_store" -nt "$__cf_marker"; or return 0',
      '    end',
      '    touch "$__cf_marker" 2>/dev/null',
      '    set -l __cf_out (command claudefob export --shell fish --sync 2>/dev/null)',
      '    or return 0',
      '    test -n "$__cf_out"; and eval $__cf_out',
      '    return 0',
      'end',
      'end',
      '# <<< claudefob <<<',
    ].join('\n')
  },
}
