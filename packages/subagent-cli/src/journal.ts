import { CliFailure } from './failure.ts'

export const STORAGE_TIMEOUT_MS = 5_000

export async function boundedStorage<T>(operation: () => Promise<T>, timeoutMs = STORAGE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new CliFailure('persistence-failed')), timeoutMs) }),
    ])
  } catch { throw new CliFailure('persistence-failed') }
  finally { if (timer !== undefined) clearTimeout(timer) }
}
