import React, { useState } from 'react'
import { KeyRound, LogIn, User } from 'lucide-react'
import { useSession } from '../store/session'
import { Field, Input, Spinner } from '../components/ui'
import { errorMessage } from '../lib/api'

export function Login(): React.JSX.Element {
  const { login, settings } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-bl from-brand-950 via-brand-800 to-brand-600 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold text-white backdrop-blur">
            {(settings?.company.name ?? 'ش').slice(0, 2)}
          </div>
          <h1 className="text-xl font-bold text-white">{settings?.company.name ?? 'نظام إدارة الأعمال'}</h1>
          <p className="mt-1 text-sm text-white/70">نظام إدارة الأعمال والحسابات</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="mb-5 text-center text-base font-bold text-slate-800">تسجيل الدخول</h2>

          {error && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">
              {error}
            </div>
          )}

          <Field label="اسم المستخدم" className="mb-4">
            <div className="relative">
              <User className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pr-9"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="اسم المستخدم"
                autoComplete="username"
              />
            </div>
          </Field>

          <Field label="كلمة المرور" className="mb-5">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pr-9"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
          </Field>

          <button type="submit" className="btn-primary w-full" disabled={loading || !username || !password}>
            {loading ? <Spinner className="h-4 w-4 text-white" /> : <LogIn className="h-4 w-4" />}
            دخول
          </button>
        </form>

        <p className="mt-5 text-center text-[12px] text-white/60">
          جميع البيانات محفوظة محليًا على هذا الجهاز
        </p>
      </div>
    </div>
  )
}
