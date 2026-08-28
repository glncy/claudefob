import pc from 'picocolors'

const enabled = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR

function wrap(fn: (s: string) => string) {
  return (s: string) => (enabled ? fn(s) : s)
}

export const colors = {
  bold: wrap(pc.bold),
  dim: wrap(pc.dim),
  green: wrap(pc.green),
  red: wrap(pc.red),
  yellow: wrap(pc.yellow),
  cyan: wrap(pc.cyan),
}
