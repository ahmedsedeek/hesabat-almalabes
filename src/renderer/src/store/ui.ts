import { create } from 'zustand'

export interface Toast {
  id: number
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  description?: string
}

interface UiState {
  toasts: Toast[]
  sidebarCollapsed: boolean
  searchOpen: boolean
  notify: (toast: Omit<Toast, 'id'>) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  dismiss: (id: number) => void
  toggleSidebar: () => void
  setSearchOpen: (open: boolean) => void
}

let counter = 0

export const useUi = create<UiState>((set) => ({
  toasts: [],
  sidebarCollapsed: false,
  searchOpen: false,

  notify: (toast) => {
    const id = ++counter
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), toast.type === 'error' ? 7000 : 4000)
  },

  success: (title, description) => useUi.getState().notify({ type: 'success', title, description }),
  error: (title, description) => useUi.getState().notify({ type: 'error', title, description }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSearchOpen: (open) => set({ searchOpen: open })
}))
