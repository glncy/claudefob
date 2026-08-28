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
      '',
      '# Keeps already-open terminals in step with a switch made elsewhere.',
      'if (-not (Test-Path Function:\\__claudefob_origPrompt)) {',
      '  Rename-Item Function:\\prompt __claudefob_origPrompt -ErrorAction SilentlyContinue',
      '}',
      'function prompt {',
      '  try {',
      '    $store = Join-Path $env:APPDATA "claudefob\\store.json"',
      '    if (Test-Path $store) {',
      '      $stamp = (Get-Item $store).LastWriteTimeUtc.Ticks',
      '      if ($global:__claudefobStamp -ne $stamp) {',
      '        $global:__claudefobStamp = $stamp',
      '        $out = (& claudefob export --shell powershell --sync 2>$null) -join "`n"',
      '        if ($out) { Invoke-Expression $out }',
      '      }',
      '    }',
      '  } catch { }',
      '  if (Get-Command __claudefob_origPrompt -ErrorAction SilentlyContinue) { __claudefob_origPrompt }',
      '  else { "PS " + (Get-Location) + "> " }',
      '}',
      '# <<< claudefob <<<',
    ].join('\n')
  },
}
