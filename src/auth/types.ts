export interface AuthBackend {
  id: string
  describe(): string
  challenge(): Promise<boolean>
}

export class AuthUnavailableError extends Error {}
