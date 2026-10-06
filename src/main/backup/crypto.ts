import crypto from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'

/**
 * تشفير وضغط النسخ الاحتياطية.
 * الصيغة: [ترويسة 4 بايت "HMB1"][ملح 16][متجه تهيئة 12][بطاقة مصادقة 16][البيانات المضغوطة المشفَّرة]
 * الخوارزمية: AES-256-GCM بمفتاح مشتق عبر scrypt — تمنع فك التشفير أو التلاعب دون كلمة المرور.
 */
const MAGIC = Buffer.from('HMB1', 'ascii')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })
}

/** ضغط الملف بـ gzip فقط (بدون تشفير) */
export async function compressFile(source: string, destination: string): Promise<void> {
  await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 9 }), fs.createWriteStream(destination))
}

export async function decompressFile(source: string, destination: string): Promise<void> {
  await pipeline(fs.createReadStream(source), zlib.createGunzip(), fs.createWriteStream(destination))
}

/** ضغط ثم تشفير */
export function encryptFileSync(source: string, destination: string, passphrase: string): void {
  const plain = zlib.gzipSync(fs.readFileSync(source), { level: 9 })
  const salt = crypto.randomBytes(SALT_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  fs.writeFileSync(destination, Buffer.concat([MAGIC, salt, iv, tag, encrypted]))
}

/** فك التشفير ثم فك الضغط */
export function decryptFileSync(source: string, destination: string, passphrase: string): void {
  const buffer = fs.readFileSync(source)
  if (!buffer.subarray(0, 4).equals(MAGIC)) {
    throw new Error('BACKUP_FORMAT')
  }
  let offset = 4
  const salt = buffer.subarray(offset, (offset += SALT_LEN))
  const iv = buffer.subarray(offset, (offset += IV_LEN))
  const tag = buffer.subarray(offset, (offset += TAG_LEN))
  const data = buffer.subarray(offset)
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(data), decipher.final()])
  fs.writeFileSync(destination, zlib.gunzipSync(plain))
}

export function isEncryptedBackup(file: string): boolean {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(4)
    fs.readSync(fd, head, 0, 4, 0)
    return head.equals(MAGIC)
  } finally {
    fs.closeSync(fd)
  }
}

export function sha256File(file: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}
