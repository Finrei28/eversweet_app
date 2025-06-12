import { useCallback, useEffect, useState } from "react"

export default function useFetch<T>(
  fetchFunction: () => Promise<T>,
  autoFetch = true
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null) // Reset error state before fetching

      const result = await fetchFunction()

      setData(result)
    } catch (error) {
      setError(error instanceof Error ? error : new Error("An error occurred."))
    } finally {
      setLoading(false)
    }
  }
  const reset = () => {
    setData(null)
    setLoading(false)
    setError(null)
  }

  const refetch = useCallback(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (autoFetch) {
      fetchData()
    }
  }, [])

  return { data, loading, error, refetch, reset }
}
