import type { ShellCodegen } from './index.ts'

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export const powershellCodegen: ShellCodegen = {
  id: 'powershell',
  quote,
  setEnv(name, value) {
    return `$env:${name}=${quote(value)}`
  },
  unsetEnv(name) {
    return `Remove-Item Env:\\${name} -ErrorAction SilentlyContinue`
  },
  hookBlock() {
    return [
      '# >>> claudefob >>>',
      "$env:CLAUDEFOB_HOOK = '1'",
      '$__cf = (claudefob export --shell powershell | Out-String)',
      'if ($__cf.Trim()) { Invoke-Expression $__cf }',
      'function claudefob {',
      '    $__cf_out = & (Get-Command claudefob -CommandType Application).Source @args --shell powershell',
      '    if ($LASTEXITCODE -ne 0) { return }',
      '    if ($__cf_out) { ($__cf_out -join "`n") | Invoke-Expression }',
      '}',
      '# <<< claudefob <<<',
    ].join('\n')
  },
}
