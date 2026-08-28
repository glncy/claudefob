import { isCancel, password, select, confirm, intro as clackIntro, outro as clackOutro, log } from '@clack/prompts'
import { UsageError } from './errors.ts'

const stream = { input: process.stdin, output: process.stderr }

export function requireTTY(): void {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new UsageError('This command requires an interactive terminal.')
  }
}

export function isCancelled(v: unknown): boolean {
  return isCancel(v)
}

export async function selectToken<T extends string>(
  title: string,
  options: { value: T; label: string; hint?: string }[],
  initial?: T,
): Promise<T | symbol> {
  return select<T>({ message: title, options: options as never, initialValue: initial, ...stream }) as Promise<T | symbol>
}

export async function passwordPrompt(message: string): Promise<string | symbol> {
  return password({ message, ...stream })
}

export async function confirmPrompt(message: string): Promise<boolean | symbol> {
  return confirm({ message, ...stream })
}

export function note(msg: string): void {
  log.message(msg, stream)
}

export function intro(msg: string): void {
  clackIntro(msg, stream)
}

export function outro(msg: string): void {
  clackOutro(msg, stream)
}
