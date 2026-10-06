import { todayIso } from '@shared/date'
import fs from 'node:fs'
import path from 'node:path'

/**
 * سجل الأخطاء التقني — يُكتب في ملف ولا يُعرض للمستخدم أبدًا.
 * المستخدم يرى رسائل عربية واضحة فقط، والتفاصيل التقنية تبقى هنا للدعم الفني.
 */
export class Logger {
  private readonly file: string

  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, `app-${todayIso()}.log`)
    this.rotate()
  }

  private write(level: string, message: string, meta?: unknown): void {
    const line = `[${new Date().toISOString()}] [${level}] ${message}${meta ? ` ${safeJson(meta)}` : ''}\n`
    try {
      fs.appendFileSync(this.file, line)
    } catch {
      // لا يجوز أن يُسقط فشل الكتابة في السجل التطبيقَ نفسه
    }
    if (level === 'ERROR') console.error(line.trim())
  }

  info(message: string, meta?: unknown): void { this.write('INFO', message, meta) }
  warn(message: string, meta?: unknown): void { this.write('WARN', message, meta) }

  error(message: string, error?: unknown): void {
    const detail =
      error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error
    this.write('ERROR', message, detail)
  }

  /** حذف السجلات الأقدم من ٣٠ يومًا */
  private rotate(): void {
    try {
      const cutoff = Date.now() - 30 * 86_400_000
      for (const name of fs.readdirSync(this.dir)) {
        if (!name.startsWith('app-') || !name.endsWith('.log')) continue
        const full = path.join(this.dir, name)
        if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true })
      }
    } catch {
      // تجاهل
    }
  }

  logFilePath(): string {
    return this.file
  }

  readRecent(lines = 200): string {
    try {
      const content = fs.readFileSync(this.file, 'utf8').split('\n')
      return content.slice(-lines).join('\n')
    } catch {
      return ''
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}
