#!/usr/bin/env node
/**
 * better-sqlite3 وحدة أصلية مرتبطة بـ ABI ومعمارية محدَّدين.
 * الاختبارات تعمل على Node، والتطبيق على Electron، وأدوات التغليف قد تستبدل الملف
 * بنسخة مبنية لنظام آخر. هذا السكربت يحتفظ بنسخة لكل بيئة في .native-cache
 * ويتحقق من أن الملف الموجود فعلًا هو المطلوب — لا يكتفي بما سُجِّل سابقًا.
 *
 * ترتيب المحاولات:
 *   ١) الذاكرة المؤقتة المحلية
 *   ٢) النسخة الرسمية المبنية مسبقًا (prebuild-install) — الأسرع ولا تحتاج أدوات ترجمة
 *   ٣) الترجمة من المصدر (node-gyp) كحل أخير
 *
 * الاستخدام: node scripts/use-abi.mjs node|electron
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] === 'electron' ? 'electron' : 'node'
const cacheDir = path.join(root, '.native-cache')
const moduleDir = path.join(root, 'node_modules', 'better-sqlite3')
const binPath = path.join(moduleDir, 'build', 'Release', 'better_sqlite3.node')

const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
).version

// المعمارية جزء من المفتاح لأن أدوات التغليف قد تعيد الترجمة لمعمارية أخرى
const abiKey =
  target === 'electron'
    ? `electron-${electronVersion}-${process.platform}-${process.arch}`
    : `node-${process.versions.modules}-${process.platform}-${process.arch}`
const cached = path.join(cacheDir, `${abiKey}.node`)

fs.mkdirSync(cacheDir, { recursive: true })

const sha = (file) =>
  fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null

// ١) التحقق الحقيقي: هل الملف الموجود مطابق للنسخة المخزَّنة لهذه البيئة؟
if (fs.existsSync(cached) && sha(binPath) === sha(cached)) {
  console.log(`[abi] ${abiKey} جاهز بالفعل`)
  process.exit(0)
}

// احفظ الملف الحالي إن كان يطابق بيئة أخرى معروفة حتى لا نعيد تجهيزه لاحقًا
if (fs.existsSync(binPath)) {
  const current = sha(binPath)
  const known = fs
    .readdirSync(cacheDir)
    .filter((f) => f.endsWith('.node'))
    .some((f) => sha(path.join(cacheDir, f)) === current)
  if (!known) fs.copyFileSync(binPath, path.join(cacheDir, `unknown-${current.slice(0, 12)}.node`))
}

if (fs.existsSync(cached)) {
  fs.mkdirSync(path.dirname(binPath), { recursive: true })
  fs.copyFileSync(cached, binPath)
  console.log(`[abi] تم استرجاع ${abiKey} من الذاكرة المؤقتة`)
  process.exit(0)
}

/** تشغيل أمر داخل مجلد الوحدة وإرجاع نجاحه دون إسقاط السكربت */
function tryRun(file, args, label) {
  try {
    execFileSync(file, args, { cwd: moduleDir, stdio: 'inherit' })
    return fs.existsSync(binPath)
  } catch (error) {
    console.warn(`[abi] تعذّر ${label}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

// ٢) النسخة الرسمية المبنية مسبقًا — لا تحتاج Python ولا أدوات ترجمة
const prebuildInstall = path.join(root, 'node_modules', 'prebuild-install', 'bin.js')
let ready = false

if (fs.existsSync(prebuildInstall)) {
  console.log(`[abi] محاولة جلب نسخة جاهزة لـ ${abiKey}…`)
  const args = [prebuildInstall, '--arch', process.arch, '--platform', process.platform]
  if (target === 'electron') {
    args.push('--runtime', 'electron', '--target', electronVersion)
  } else {
    args.push('--runtime', 'node', '--target', process.versions.node)
  }
  ready = tryRun(process.execPath, args, 'جلب النسخة الجاهزة')
}

// ٣) الترجمة من المصدر كحل أخير
if (!ready) {
  console.log(`[abi] ترجمة better-sqlite3 لـ ${abiKey} من المصدر (قد تستغرق دقيقة أو اثنتين)…`)
  const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  const gypArgs = [nodeGyp, 'rebuild', '--release', `--arch=${process.arch}`]
  if (target === 'electron') {
    gypArgs.push(`--target=${electronVersion}`, '--runtime=electron', '--dist-url=https://electronjs.org/headers')
  }
  // استدعاء node-gyp عبر Node مباشرة بدل npx — أكثر موثوقية على ويندوز
  ready = fs.existsSync(nodeGyp) && tryRun(process.execPath, gypArgs, 'الترجمة من المصدر')
}

if (!ready) {
  console.error(
    `[abi] تعذّر تجهيز better-sqlite3 لـ ${abiKey}.\n` +
      '      تأكد من الاتصال بالإنترنت، أو ثبّت أدوات الترجمة (Python و C++ build tools).'
  )
  process.exit(1)
}

fs.copyFileSync(binPath, cached)
console.log(`[abi] اكتمل تجهيز ${abiKey}`)
