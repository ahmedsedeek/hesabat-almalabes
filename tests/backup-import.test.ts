import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@main/db/connection'
import { BackupService } from '@main/backup/backup.service'
import { decryptFileSync, encryptFileSync, isEncryptedBackup, sha256File } from '@main/backup/crypto'
import { ImportService, parseCsv } from '@main/services/import.service'
import { ExportService } from '@main/services/export.service'
import { PartyService } from '@main/services/party.service'
import { ProductService } from '@main/services/product.service'
import { InventoryService } from '@main/inventory/inventory.service'
import { SettingsService } from '@main/services/settings.service'
import { LedgerService } from '@main/accounting/ledger'
import { ACC } from '@main/accounting/chart'
import { toMinor } from '@shared/money'
import type { Ctx } from '@main/core/context'
import { createAdmin, removeDir } from './helpers'
import type { SessionUser } from '@shared/types'

let tmpDir: string
let ctx: Ctx
let user: SessionUser

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'))
  const db = openDatabase({ file: path.join(tmpDir, 'data', 'business.db'), seed: true })
  user = createAdmin(db)
  ctx = { db, user, device: 'test' }
})

afterEach(() => {
  try {
    ctx.db.close()
  } catch {
    // قد تكون مغلقة بعد الاستعادة
  }
  removeDir(tmpDir)
})

function backupService(): BackupService {
  return new BackupService(ctx, {
    databaseFile: path.join(tmpDir, 'data', 'business.db'),
    defaultBackupDir: path.join(tmpDir, 'backups'),
    appVersion: '1.0.0'
  })
}

describe('التشفير والضغط', () => {
  it('يشفّر الملف ويفكّه بنفس المحتوى', () => {
    const source = path.join(tmpDir, 'plain.txt')
    const encrypted = path.join(tmpDir, 'enc.hmbak')
    const restored = path.join(tmpDir, 'restored.txt')
    fs.writeFileSync(source, 'بيانات مالية سرية — اختبار')

    encryptFileSync(source, encrypted, 'كلمة-سر-قوية-123')
    expect(isEncryptedBackup(encrypted)).toBe(true)
    decryptFileSync(encrypted, restored, 'كلمة-سر-قوية-123')
    expect(fs.readFileSync(restored, 'utf8')).toBe('بيانات مالية سرية — اختبار')
  })

  it('يرفض فك التشفير بكلمة مرور خاطئة', () => {
    const source = path.join(tmpDir, 'plain.txt')
    const encrypted = path.join(tmpDir, 'enc.hmbak')
    fs.writeFileSync(source, 'محتوى')
    encryptFileSync(source, encrypted, 'كلمة-صحيحة-1')
    expect(() => decryptFileSync(encrypted, path.join(tmpDir, 'out.txt'), 'كلمة-خاطئة-2')).toThrowError()
  })
})

describe('النسخ الاحتياطي والاستعادة', () => {
  it('ينشئ نسخة مشفّرة ويتحقق من سلامتها', async () => {
    new PartyService(ctx).create({ partyType: 'customer', name: 'عميل قبل النسخ', openingBalance: toMinor(1234) })
    const service = backupService()
    const result = await service.create('manual')

    expect(fs.existsSync(result.filePath)).toBe(true)
    expect(result.encrypted).toBe(true)
    expect(result.sizeBytes).toBeGreaterThan(0)
    expect(isEncryptedBackup(result.filePath)).toBe(true)

    const verification = await service.verify(result.filePath)
    expect(verification.ok).toBe(true)
    expect(verification.problems).toHaveLength(0)
    fs.rmSync(verification.tempFile, { force: true })
  })

  it('يستعيد البيانات كما كانت وقت النسخ', async () => {
    const parties = new PartyService(ctx)
    parties.create({ partyType: 'customer', name: 'عميل موجود في النسخة' })
    const service = backupService()
    const backup = await service.create('manual')

    // بيانات أُضيفت بعد النسخة ويجب ألا تظهر بعد الاستعادة
    parties.create({ partyType: 'customer', name: 'عميل بعد النسخة' })
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM parties').get() as { n: number }).n).toBe(2)

    const outcome = await service.restore(backup.filePath)
    expect(outcome.requiresRestart).toBe(true)
    expect(fs.existsSync(outcome.safetyBackup)).toBe(true)

    const reopened = openDatabase({ file: path.join(tmpDir, 'data', 'business.db'), seed: false })
    const rows = reopened.prepare('SELECT name FROM parties').all() as { name: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('عميل موجود في النسخة')
    reopened.close()
    ctx.db = reopened
  })

  it('يرفض استعادة ملف تالف', async () => {
    const service = backupService()
    const broken = path.join(tmpDir, 'broken.hmbak')
    fs.writeFileSync(broken, 'ليس ملف نسخة احتياطية')
    await expect(service.verify(broken)).rejects.toThrowError(/تعذّر فتح ملف النسخة/)
  })

  it('ينسخ إلى مجلد المزامنة السحابية مع التحقق من البصمة', async () => {
    const cloudDir = path.join(tmpDir, 'cloud')
    new SettingsService(ctx.db).update('backup', { cloudEnabled: true, cloudProvider: 'folder', cloudFolder: cloudDir })

    const service = backupService()
    const local = await service.create('manual')
    const uploaded = await service.uploadToCloud(local.filePath)

    expect(fs.existsSync(uploaded.filePath)).toBe(true)
    expect(sha256File(uploaded.filePath)).toBe(sha256File(local.filePath))
    expect(uploaded.destination).toBe('cloud')
  })

  it('يحتفظ بعدد النسخ المحدد فقط', async () => {
    new SettingsService(ctx.db).update('backup', { retentionCount: 2 })
    const service = backupService()
    for (let i = 0; i < 4; i++) {
      await service.create('manual')
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
    const files = fs.readdirSync(path.join(tmpDir, 'backups')).filter((f) => f.startsWith('backup-'))
    expect(files.length).toBeLessThanOrEqual(2)
  })
})

describe('قراءة CSV', () => {
  it('يتعامل مع الاقتباسات والفواصل داخل النص', () => {
    const rows = parseCsv('الاسم,الهاتف\n"شركة النور, والتجارة",0100\nمحمد,0111')
    expect(rows).toHaveLength(3)
    expect(rows[1][0]).toBe('شركة النور, والتجارة')
    expect(rows[2][1]).toBe('0111')
  })
})

describe('استيراد البيانات', () => {
  it('يستورد العملاء مع أرصدتهم الافتتاحية', async () => {
    const file = path.join(tmpDir, 'customers.csv')
    fs.writeFileSync(
      file,
      'الاسم,الهاتف,الرصيد الافتتاحي,تاريخ الرصيد الافتتاحي\nمحل الشروق,01001234567,5000,01/01/2026\nمحل الفجر,01007654321,0,01/01/2026\n',
      'utf8'
    )

    const service = new ImportService(ctx)
    const preview = await service.preview('customers', file)
    expect(preview.rows).toHaveLength(2)
    expect(preview.errorCount).toBe(0)
    expect(preview.rows[0].values.name).toBe('محل الشروق')

    const result = service.commit('customers', preview.rows)
    expect(result.imported).toBe(2)

    const parties = new PartyService(ctx).list({ partyType: 'customer' })
    expect(parties.total).toBe(2)
    const shorouk = parties.rows.find((p) => p.name === 'محل الشروق')
    expect(shorouk?.balance).toBe(toMinor(5000))
    expect(new LedgerService(ctx).balanceByKey(ACC.RECEIVABLE)).toBe(toMinor(5000))
  })

  it('يرفض الصفوف الناقصة ويبلّغ عنها دون استيرادها', async () => {
    const file = path.join(tmpDir, 'bad.csv')
    fs.writeFileSync(file, 'الاسم,الرصيد الافتتاحي\nعميل سليم,100\n,200\nعميل ثالث,ليس رقمًا\n', 'utf8')

    const service = new ImportService(ctx)
    const preview = await service.preview('customers', file)
    expect(preview.validCount).toBe(1)
    expect(preview.errorCount).toBe(2)
    expect(preview.rows[1].errors[0]).toContain('مطلوب')

    expect(() => service.commit('customers', preview.rows)).toThrowError(/غير صالح/)
    const result = service.commit('customers', preview.rows, { skipInvalid: true })
    expect(result.imported).toBe(1)
  })

  it('يستورد المنتجات مع المقاسات والألوان', async () => {
    const file = path.join(tmpDir, 'products.csv')
    fs.writeFileSync(
      file,
      'اسم المنتج,النوع,الوحدة,المقاس,اللون,سعر البيع,سعر الشراء\nتيشيرت قطن,جاهز,قطعة,L,أسود,150,90\nقماش قطن,خام,متر,,,12,10\n',
      'utf8'
    )
    const service = new ImportService(ctx)
    const preview = await service.preview('products', file)
    expect(preview.errorCount).toBe(0)
    service.commit('products', preview.rows)

    const products = new ProductService(ctx).list({})
    expect(products.total).toBe(2)
    const raw = products.rows.find((p) => p.product_type === 'raw')
    expect(raw?.name).toBe('قماش قطن')
    expect(raw?.unit).toBe('متر')
  })

  it('يستورد أرصدة المخزون الافتتاحية كتسوية واحدة بقيد محاسبي', async () => {
    const productId = new ProductService(ctx).create({ name: 'قميص', sku: 'PR00001', unit: 'قطعة' })
    const sku = (ctx.db.prepare('SELECT sku FROM product_variants WHERE product_id = ?').get(productId) as { sku: string }).sku

    const file = path.join(tmpDir, 'stock.csv')
    fs.writeFileSync(file, `كود الصنف,الكمية,تكلفة الوحدة\n${sku},250,40\n`, 'utf8')

    const service = new ImportService(ctx)
    const preview = await service.preview('opening_stock', file)
    expect(preview.errorCount).toBe(0)
    service.commit('opening_stock', preview.rows)

    const variantId = (ctx.db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku) as { id: number }).id
    expect(new InventoryService(ctx).totalStock(variantId)).toBe(250)
    expect(new LedgerService(ctx).balanceByKey(ACC.INVENTORY_FINISHED)).toBe(toMinor(10_000))
  })

  it('يرفض أرصدة مخزون لأصناف غير موجودة', async () => {
    const file = path.join(tmpDir, 'stock-bad.csv')
    fs.writeFileSync(file, 'كود الصنف,الكمية,تكلفة الوحدة\nUNKNOWN-SKU,10,5\n', 'utf8')
    const preview = await new ImportService(ctx).preview('opening_stock', file)
    expect(preview.errorCount).toBe(1)
    expect(preview.rows[0].errors[0]).toContain('لا يوجد صنف')
  })

  it('يولّد قالب Excel بالأعمدة المطلوبة', async () => {
    const target = path.join(tmpDir, 'template.xlsx')
    await new ImportService(ctx).writeTemplate('customers', target)
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.statSync(target).size).toBeGreaterThan(1000)
  })
})

describe('تصدير التقارير', () => {
  it('يصدّر ملف Excel قابلًا للقراءة', async () => {
    const target = path.join(tmpDir, 'report.xlsx')
    await new ExportService().toExcel(
      {
        title: 'تقرير تجريبي',
        subtitle: 'من 01/01/2026 إلى 31/01/2026',
        columns: [
          { key: 'name', label: 'الاسم', type: 'text' },
          { key: 'amount', label: 'المبلغ', type: 'money' }
        ],
        rows: [{ name: 'عميل أول', amount: 123456 }],
        totals: { amount: 123456 }
      },
      target
    )
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.statSync(target).size).toBeGreaterThan(1000)
  })

  it('يصدّر CSV بترميز يدعم العربية', () => {
    const target = path.join(tmpDir, 'report.csv')
    new ExportService().toCsv(
      {
        title: 'تقرير',
        columns: [
          { key: 'name', label: 'الاسم' },
          { key: 'amount', label: 'المبلغ', type: 'money' }
        ],
        rows: [{ name: 'شركة, النور', amount: 50000 }]
      },
      target
    )
    const content = fs.readFileSync(target, 'utf8')
    expect(content.startsWith('﻿')).toBe(true)
    expect(content).toContain('"شركة, النور"')
    expect(content).toContain('500.00')
  })
})
