export function emitShellCode(code: string): void {
  if (!code) return
  process.stdout.write(code + '\n')
}

export function err(msg: string): void {
  process.stderr.write(msg + '\n')
}

export function errJson(obj: unknown): void {
  process.stderr.write(JSON.stringify(obj, null, 2) + '\n')
}
