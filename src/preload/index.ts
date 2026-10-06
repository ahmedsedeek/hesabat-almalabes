import { contextBridge, ipcRenderer } from 'electron'

const IPC_CHANNEL = 'api:invoke'

export interface InvokeResult<T> {
  ok: boolean
  data?: T
  error?: { __appError: true; code: string; message: string; field?: string; details?: unknown }
}

/**
 * الجسر الآمن بين الواجهة والعمليات الخلفية.
 * الواجهة لا تصل إلى قاعدة البيانات أو نظام الملفات مباشرة إطلاقًا —
 * كل شيء يمرّ عبر قناة واحدة تُفحص فيها الصلاحيات.
 */
const api = {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<InvokeResult<T>> {
    return ipcRenderer.invoke(IPC_CHANNEL, channel, payload)
  },
  onMessage(callback: (message: { type: string; payload?: unknown }) => void): () => void {
    const listener = (_e: unknown, message: { type: string; payload?: unknown }): void => callback(message)
    ipcRenderer.on('app:message', listener)
    return () => ipcRenderer.removeListener('app:message', listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api
