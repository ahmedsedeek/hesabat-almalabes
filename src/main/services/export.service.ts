import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { formatMoney, fromMinor } from '@shared/money'

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'qty'

export interface ExportColumn {
  key: string
  label: string
  type?: ColumnType
  width?: number
}

export interface ExportTable {
  title: string
  subtitle?: string
  meta?: { label: string; value: string }[]
  columns: ExportColumn[]
  rows: Record<string, unknown>[]
  totals?: Record<string, unknown>
  currencySymbol?: string
}

function cellValue(row: Record<string, unknown>, column: ExportColumn): string | number | null {
  const raw = row[column.key]
  if (raw === null || raw === undefined) return null
  if (column.type === 'money') return fromMinor(Number(raw))
  if (column.type === 'number' || column.type === 'qty') return Number(raw)
  return String(raw)
}

/** تصدير الجداول إلى Excel و CSV بتنسيق عربي يدعم الاتجاه من اليمين لليسار */
export class ExportService {
  async toExcel(table: ExportTable, filePath: string): Promise<string> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'نظام إدارة الأعمال'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet(table.title.slice(0, 30), {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: table.meta?.length ? table.meta.length + 3 : 2 }],
      pageSetup: { orientation: 'landscape', fitToPage: true }
    })

    const columnCount = table.columns.length
    sheet.mergeCells(1, 1, 1, columnCount)
    const titleCell = sheet.getCell(1, 1)
    titleCell.value = table.title
    titleCell.font = { size: 16, bold: true }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(1).height = 28

    let rowIndex = 2
    if (table.subtitle) {
      sheet.mergeCells(rowIndex, 1, rowIndex, columnCount)
      const cell = sheet.getCell(rowIndex, 1)
      cell.value = table.subtitle
      cell.alignment = { horizontal: 'center' }
      cell.font = { size: 11, color: { argb: 'FF555555' } }
      rowIndex++
    }
    for (const meta of table.meta ?? []) {
      sheet.getCell(rowIndex, 1).value = meta.label
      sheet.getCell(rowIndex, 1).font = { bold: true }
      sheet.getCell(rowIndex, 2).value = meta.value
      rowIndex++
    }
    rowIndex++

    const headerRow = sheet.getRow(rowIndex)
    table.columns.forEach((column, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = column.label
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A70DB' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'thin' } }
      sheet.getColumn(i + 1).width = column.width ?? (column.type === 'text' ? 24 : 16)
    })
    headerRow.height = 22
    rowIndex++

    for (const row of table.rows) {
      const excelRow = sheet.getRow(rowIndex)
      table.columns.forEach((column, i) => {
        const cell = excelRow.getCell(i + 1)
        cell.value = cellValue(row, column)
        if (column.type === 'money') cell.numFmt = '#,##0.00'
        if (column.type === 'number') cell.numFmt = '#,##0'
        if (column.type === 'qty') cell.numFmt = '#,##0.###'
        cell.alignment = { horizontal: column.type === 'text' || !column.type ? 'right' : 'left' }
      })
      rowIndex++
    }

    if (table.totals) {
      const totalRow = sheet.getRow(rowIndex)
      table.columns.forEach((column, i) => {
        const cell = totalRow.getCell(i + 1)
        const value = table.totals?.[column.key]
        cell.value = i === 0 && value === undefined ? 'الإجمالي' : value === undefined ? null : cellValue(table.totals!, column)
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        if (column.type === 'money') cell.numFmt = '#,##0.00'
      })
    }

    await workbook.xlsx.writeFile(filePath)
    return filePath
  }

  toCsv(table: ExportTable, filePath: string): string {
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? '' : String(value)
      return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const lines: string[] = []
    lines.push(escape(table.title))
    if (table.subtitle) lines.push(escape(table.subtitle))
    for (const meta of table.meta ?? []) lines.push(`${escape(meta.label)},${escape(meta.value)}`)
    lines.push('')
    lines.push(table.columns.map((c) => escape(c.label)).join(','))
    for (const row of table.rows) {
      lines.push(
        table.columns
          .map((column) => {
            const value = cellValue(row, column)
            return escape(column.type === 'money' && typeof value === 'number' ? value.toFixed(2) : value)
          })
          .join(',')
      )
    }
    if (table.totals) {
      lines.push(
        table.columns
          .map((column, i) => {
            const value = table.totals?.[column.key]
            if (i === 0 && value === undefined) return escape('الإجمالي')
            if (value === undefined) return ''
            const v = cellValue(table.totals!, column)
            return escape(column.type === 'money' && typeof v === 'number' ? v.toFixed(2) : v)
          })
          .join(',')
      )
    }
    // BOM حتى تفتح ملفات CSV العربية بشكل صحيح في Excel
    fs.writeFileSync(filePath, `﻿${lines.join('\n')}`, 'utf8')
    return filePath
  }

  /** تنسيق قيمة نقدية للعرض داخل جداول HTML المُعدّة للطباعة */
  static money(minor: number, symbol = ''): string {
    return formatMoney(minor, { currencySymbol: symbol })
  }
}
