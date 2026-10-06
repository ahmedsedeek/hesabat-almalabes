import type { Permission } from './permissions'

export type PartyType = 'customer' | 'supplier' | 'factory'
export type DocumentStatus = 'draft' | 'confirmed' | 'void'
export type ProductType = 'finished' | 'raw' | 'service'
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type PaymentDirection = 'in' | 'out'
export type ProductionStatus = 'draft' | 'sent' | 'in_production' | 'partial' | 'completed' | 'cancelled'

export interface SessionUser {
  id: number
  username: string
  fullName: string
  roleId: number
  roleCode: string
  roleName: string
  permissions: Permission[]
}

export interface CompanyProfile {
  name: string
  legalName?: string
  address?: string
  city?: string
  phone?: string
  email?: string
  website?: string
  taxNumber?: string
  commercialReg?: string
  logoPath?: string
  invoiceFooter?: string
  bankDetails?: string
}

export interface AppSettings {
  company: CompanyProfile
  currency: { code: string; symbol: string; decimals: number; name: string }
  locale: { language: 'ar' | 'en'; dateFormat: string; useArabicDigits: boolean }
  tax: { enabled: boolean; defaultRate: number; label: string; inclusive: boolean }
  inventory: { allowNegativeStock: boolean; costingMethod: 'moving_average' }
  backup: {
    localEnabled: boolean
    localPath: string
    frequency: 'daily' | 'weekly' | 'manual'
    retentionCount: number
    cloudEnabled: boolean
    cloudProvider: 'none' | 'gdrive' | 'onedrive' | 'dropbox' | 'folder'
    cloudFolder: string
    encrypt: boolean
    lastLocalBackupAt?: string
    lastCloudBackupAt?: string
  }
  notifications: { lowStock: boolean; overdueReceivables: boolean; overdueDays: number; backupStatus: boolean }
  setupCompleted: boolean
}

export interface PartyRecord {
  id: number
  partyType: PartyType
  code: string
  name: string
  companyName?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  taxNumber?: string | null
  commercialReg?: string | null
  contactPerson?: string | null
  openingBalance: number
  openingDate?: string | null
  creditLimit: number
  paymentTermsDays: number
  notes?: string | null
  isActive: boolean
  createdAt: string
}

export interface PartyWithBalance extends PartyRecord {
  balance: number
  totalInvoiced: number
  totalPaid: number
  openInvoices: number
  lastTransactionDate?: string | null
}

export interface StatementLine {
  date: string
  refType: string
  refId: number | null
  refNumber: string
  description: string
  debit: number
  credit: number
  balance: number
}

export interface Statement {
  party: PartyRecord
  from: string
  to: string
  openingBalance: number
  lines: StatementLine[]
  closingBalance: number
  totalDebit: number
  totalCredit: number
}

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export interface DateRange {
  from: string
  to: string
}
