/**
 * Runs `work` over every item, at most `limit` at a time.
 *
 * For the nightly jobs that walk every customer. Each step there is a few round trips to a
 * database on the other side of the Tasman, so one at a time made the run as long as the list
 * - and points expiry puts everyone's first deadline on the same day. A few at once cuts that
 * without letting a job take every connection in the pool away from the app's own requests.
 *
 * `work` is expected to catch its own failures, as the callers do per customer. One that
 * throws anyway stops only its own item: the rest still run, and the first error is rethrown
 * once they have.
 */
export const forEachWithConcurrency = async <T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<unknown>,
): Promise<void> => {
  let next = 0
  let firstError: unknown = undefined
  let failed = false

  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await work(item)
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workers }, worker))

  if (failed) throw firstError
}
