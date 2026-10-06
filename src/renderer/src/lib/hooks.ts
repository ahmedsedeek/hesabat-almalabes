import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from './api'

export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  setData: (value: T) => void
}

/** استدعاء بيانات من النواة مع إعادة التحميل عند تغيّر المعطيات */
export function useQuery<T>(channel: string | null, payload?: unknown, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(channel))
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  useEffect(() => {
    if (!channel) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    invoke<T>(channel, payloadRef.current)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, reload, setData }
}

/** تنفيذ إجراء يغيّر البيانات مع حالة تحميل */
export function useAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
): [(...args: TArgs) => Promise<TResult | undefined>, { loading: boolean; error: string | null }] {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (...args: TArgs) => {
      setLoading(true)
      setError(null)
      try {
        return await fn(...args)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع.')
        throw err
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return [run, { loading, error }]
}

/** تأخير تنفيذ البحث حتى يتوقف المستخدم عن الكتابة */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useEscapeKey(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') handler()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [handler, active])
}
