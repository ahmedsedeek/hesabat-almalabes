import { create } from 'zustand'
import type { AppSettings, SessionUser } from '@shared/types'
import type { Permission } from '@shared/permissions'
import { invoke } from '../lib/api'

export interface AppInfo {
  version: string
  platform: string
  paths: { backups: string; database: string; logs: string }
  hasUsers: boolean
  setupCompleted: boolean
}

interface SessionState {
  user: SessionUser | null
  settings: AppSettings | null
  info: AppInfo | null
  booted: boolean
  boot: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSettings: () => Promise<void>
  can: (permission: Permission) => boolean
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  settings: null,
  info: null,
  booted: false,

  boot: async () => {
    const [info, settings, user] = await Promise.all([
      invoke<AppInfo>('app:info'),
      invoke<AppSettings>('settings:get'),
      invoke<SessionUser | null>('auth:session')
    ])
    set({ info, settings, user, booted: true })
  },

  login: async (username, password) => {
    const user = await invoke<SessionUser>('auth:login', { username, password })
    const settings = await invoke<AppSettings>('settings:get')
    set({ user, settings })
  },

  logout: async () => {
    await invoke('auth:logout')
    set({ user: null })
  },

  refreshSettings: async () => {
    const [settings, info] = await Promise.all([invoke<AppSettings>('settings:get'), invoke<AppInfo>('app:info')])
    set({ settings, info })
  },

  can: (permission) => get().user?.permissions.includes(permission) ?? false
}))
