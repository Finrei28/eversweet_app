import { useCallback, useEffect, useRef, useState } from "react"

export default function useFetch<T>(
  fetchFunction: () => Promise<T>,
  autoFetch = true
) {
  const [data, setData] = useState<T | null>(null)
  // Follows autoFetch: starting true with autoFetch off left callers showing a
  // loader for a request that was never going to be made.
  const [loading, setLoading] = useState(autoFetch)
  const [error, setError] = useState<Error | null>(null)

  // Call sites pass an inline arrow, so fetchFunction is a new identity every
  // render. Keeping it in a ref lets refetch stay stable without freezing the
  // very first closure, which is what it used to do.
  const fetchFunctionRef = useRef(fetchFunction)
  fetchFunctionRef.current = fetchFunction

  const isMounted = useRef(true)
  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const refetch = useCallback(async () => {
    try {
      setLoading(true)
      setError(null) // Reset error state before fetching

      const result = await fetchFunctionRef.current()

      if (isMounted.current) setData(result)
    } catch (error) {
      if (isMounted.current) {
        setError(
          error instanceof Error ? error : new Error("An error occurred.")
        )
      }
    } finally {
      if (isMounted.current) setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setData(null)
    setLoading(false)
    setError(null)
  }, [])

  // refetch is stable and autoFetch is a call-site constant, so this runs once
  // on mount — which is the intent. Listing them changes nothing but keeps the
  // exhaustive-deps rule from having to be silenced.
  useEffect(() => {
    if (autoFetch) {
      void refetch()
    }
  }, [autoFetch, refetch])

  return { data, loading, error, refetch, reset }
}
