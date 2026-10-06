#!/usr/bin/env node
/**
 * better-sqlite3 وحدة أصلية مرتبطة بـ ABI ومعمارية محدَّدين.
 * الاختبارات تعمل على Node، والتطبيق على Electron، وأدوات التغليف قد تستبدل الملف
 * بنسخة مبنية لنظام آخر. هذا السكربت يحتفظ بنسخة لكل بيئة في .native-cache
 * ويتحقق من أن الملف الموجود فعلًا هو المطلوب — لا يكتفي بما سُجِّل سابقًا.
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
const binPath = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')

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

const sha = (file) => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null)

// التحقق الحقيقي: هل الملف الموجود مطابق للنسخة المخزَّنة لهذه البيئة؟
if (fs.existsSync(cached) && sha(binPath) === sha(cached)) {
  console.log(`[abi] ${abiKey} جاهز بالفعل`)
  process.exit(0)
}

// احفظ الملف الحالي إن كان يطابق بيئة أخرى معروفة حتى لا نعيد ترجمته لاحقًا
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

console.log(`[abi] ترجمة better-sqlite3 لـ ${abiKey} (قد تستغرق دقيقة أو اثنتين)…`)
const gypArgs = ['node-gyp', 'rebuild', '--release', `--arch=${process.arch}`]
if (target === 'electron') {
  gypArgs.push(`--target=${electronVersion}`, '--runtime=electron', '--dist-url=https://electronjs.org/headers')
}
execFileSync('npx', gypArgs, {
  cwd: path.join(root, 'node_modules', 'better-sqlite3'),
  stdio: 'inherit',
  env: { ...process.env, npm_config_build_from_source: 'true' }
})
fs.copyFileSync(binPath, cached)
console.log(`[abi] اكتملت الترجمة لـ ${abiKey}`)
