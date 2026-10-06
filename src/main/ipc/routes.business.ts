import { PERMISSIONS } from '@shared/permissions'
import { PartyService } from '../services/party.service'
import { ProductService } from '../services/product.service'
import { SalesService } from '../services/sales.service'
import { PurchaseService } from '../services/purchase.service'
import { PaymentService } from '../services/payment.service'
import { ExpenseService } from '../services/expense.service'
import { ProductionService } from '../services/production.service'
import { StockService } from '../services/stock.service'
import { InventoryService } from '../inventory/inventory.service'
import { route, type RouteMap } from './types'

export const businessRoutes: RouteMap = {
  // ------------------------- الأطراف -------------------------
  'parties:list': route({
    permission: PERMISSIONS.PARTIES_VIEW,
    handler: (app, payload: any) => new PartyService(app.ctx()).list(payload ?? {})
  }),
  'parties:get': route({
    permission: PERMISSIONS.PARTIES_VIEW,
    handler: (app, payload: { id: number }) => new PartyService(app.ctx()).getWithBalance(payload.id)
  }),
  'parties:search': route({
    permission: PERMISSIONS.PARTIES_VIEW,
    handler: (app, payload: { partyType: never; term: string; limit?: number }) =>
      new PartyService(app.ctx()).search(payload.partyType, payload.term ?? '', payload.limit)
  }),
  'parties:create': route({
    permission: PERMISSIONS.PARTIES_CREATE,
    handler: (app, payload: any) => new PartyService(app.ctx()).create(payload)
  }),
  'parties:update': route({
    permission: PERMISSIONS.PARTIES_EDIT,
    handler: (app, payload: { id: number; data: never }) => {
      new PartyService(app.ctx()).update(payload.id, payload.data)
      return { ok: true }
    }
  }),
  'parties:deactivate': route({
    permission: PERMISSIONS.PARTIES_DELETE,
    handler: (app, payload: { id: number; reason?: string }) => {
      new PartyService(app.ctx()).deactivate(payload.id, payload.reason)
      return { ok: true }
    }
  }),
  'parties:delete': route({
    permission: PERMISSIONS.PARTIES_DELETE,
    handler: (app, payload: { id: number }) => {
      new PartyService(app.ctx()).remove(payload.id)
      return { ok: true }
    }
  }),
  'parties:nextCode': route({
    permission: PERMISSIONS.PARTIES_CREATE,
    handler: (app, payload: { partyType: never }) => new PartyService(app.ctx()).nextCode(payload.partyType)
  }),
  'parties:statement': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { partyId: number; from: string; to: string }) =>
      new PartyService(app.ctx()).statement(payload.partyId, payload.from, payload.to)
  }),
  'parties:aging': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { partyType: never; asOf: string }) =>
      new PartyService(app.ctx()).aging(payload.partyType, payload.asOf)
  }),

  // ------------------------- المنتجات -------------------------
  'products:list': route({
    permission: PERMISSIONS.PRODUCTS_VIEW,
    handler: (app, payload: any) => new ProductService(app.ctx()).list(payload ?? {})
  }),
  'products:get': route({
    permission: PERMISSIONS.PRODUCTS_VIEW,
    handler: (app, payload: { id: number }) => new ProductService(app.ctx()).get(payload.id)
  }),
  'products:create': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: any) => new ProductService(app.ctx()).create(payload)
  }),
  'products:update': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: { id: number; data: never }) => {
      new ProductService(app.ctx()).update(payload.id, payload.data)
      return { ok: true }
    }
  }),
  'products:delete': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: { id: number }) => {
      new ProductService(app.ctx()).remove(payload.id)
      return { ok: true }
    }
  }),
  'products:searchVariants': route({
    permission: PERMISSIONS.PRODUCTS_VIEW,
    handler: (app, payload: { term: string; warehouseId?: number; productType?: never; limit?: number }) =>
      new ProductService(app.ctx()).searchVariants(payload.term ?? '', payload)
  }),
  'products:nextSku': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: { productType: never }) => new ProductService(app.ctx()).nextSku(payload.productType)
  }),
  'categories:list': route({ permission: PERMISSIONS.PRODUCTS_VIEW, handler: (app) => new ProductService(app.ctx()).listCategories() }),
  'categories:create': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: { name: string; parentId?: number }) => new ProductService(app.ctx()).createCategory(payload.name, payload.parentId)
  }),
  'categories:update': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: { id: number; name: string }) => {
      new ProductService(app.ctx()).updateCategory(payload.id, payload.name)
      return { ok: true }
    }
  }),
  'categories:delete': route({
    permission: PERMISSIONS.PRODUCTS_MANAGE,
    handler: (app, payload: { id: number }) => {
      new ProductService(app.ctx()).deleteCategory(payload.id)
      return { ok: true }
    }
  }),

  // ------------------------- المخزون -------------------------
  'inventory:stock': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app, payload: any) => new InventoryService(app.ctx()).stockList(payload ?? {})
  }),
  'inventory:movements': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app, payload: any) => new InventoryService(app.ctx()).movements(payload ?? {})
  }),
  'inventory:value': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app, payload: { warehouseId?: number } = {}) => new InventoryService(app.ctx()).inventoryValue(payload?.warehouseId)
  }),
  'inventory:lowStock': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app) => new InventoryService(app.ctx()).lowStock()
  }),
  'stock:adjust': route({
    permission: PERMISSIONS.INVENTORY_MANAGE,
    handler: (app, payload: any) => new StockService(app.ctx()).createAdjustment(payload)
  }),
  'stock:adjustments': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app, payload: any) => new StockService(app.ctx()).listAdjustments(payload ?? {})
  }),
  'stock:adjustment': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app, payload: { id: number }) => new StockService(app.ctx()).getAdjustment(payload.id)
  }),
  'stock:voidAdjustment': route({
    permission: PERMISSIONS.INVENTORY_MANAGE,
    handler: (app, payload: { id: number; reason: string }) => {
      new StockService(app.ctx()).voidAdjustment(payload.id, payload.reason)
      return { ok: true }
    }
  }),
  'stock:transfer': route({
    permission: PERMISSIONS.INVENTORY_MANAGE,
    handler: (app, payload: any) => new StockService(app.ctx()).createTransfer(payload)
  }),
  'stock:transfers': route({
    permission: PERMISSIONS.INVENTORY_VIEW,
    handler: (app, payload: any) => new StockService(app.ctx()).listTransfers(payload ?? {})
  }),

  // ------------------------- المبيعات -------------------------
  'sales:list': route({ permission: PERMISSIONS.SALES_VIEW, handler: (app, payload: any) => new SalesService(app.ctx()).list(payload ?? {}) }),
  'sales:get': route({ permission: PERMISSIONS.SALES_VIEW, handler: (app, payload: { id: number }) => new SalesService(app.ctx()).get(payload.id) }),
  'sales:create': route({ permission: PERMISSIONS.SALES_CREATE, handler: (app, payload: any) => new SalesService(app.ctx()).create(payload) }),
  'sales:void': route({
    permission: PERMISSIONS.SALES_VOID,
    handler: (app, payload: { id: number; reason: string }) => {
      new SalesService(app.ctx()).void(payload.id, payload.reason)
      return { ok: true }
    }
  }),
  'sales:returnableItems': route({
    permission: PERMISSIONS.SALES_VIEW,
    handler: (app, payload: { saleId: number }) => new SalesService(app.ctx()).returnableItems(payload.saleId)
  }),
  'sales:createReturn': route({
    permission: PERMISSIONS.SALES_CREATE,
    handler: (app, payload: any) => new SalesService(app.ctx()).createReturn(payload)
  }),
  'sales:voidReturn': route({
    permission: PERMISSIONS.SALES_VOID,
    handler: (app, payload: { id: number; reason: string }) => {
      new SalesService(app.ctx()).voidReturn(payload.id, payload.reason)
      return { ok: true }
    }
  }),
  'sales:returns': route({
    permission: PERMISSIONS.SALES_VIEW,
    handler: (app, payload: { from?: string; to?: string; customerId?: number } = {}) =>
      app.db
        .prepare(
          `SELECT r.*, p.name AS customer_name FROM sales_returns r JOIN parties p ON p.id = r.customer_id
           WHERE (@from IS NULL OR r.date >= @from) AND (@to IS NULL OR r.date <= @to)
             AND (@customerId IS NULL OR r.customer_id = @customerId)
           ORDER BY r.date DESC, r.id DESC LIMIT 500`
        )
        .all({ from: payload?.from ?? null, to: payload?.to ?? null, customerId: payload?.customerId ?? null })
  }),

  // ------------------------- المشتريات -------------------------
  'purchases:list': route({ permission: PERMISSIONS.PURCHASES_VIEW, handler: (app, payload: any) => new PurchaseService(app.ctx()).list(payload ?? {}) }),
  'purchases:get': route({ permission: PERMISSIONS.PURCHASES_VIEW, handler: (app, payload: { id: number }) => new PurchaseService(app.ctx()).get(payload.id) }),
  'purchases:create': route({ permission: PERMISSIONS.PURCHASES_CREATE, handler: (app, payload: any) => new PurchaseService(app.ctx()).create(payload) }),
  'purchases:void': route({
    permission: PERMISSIONS.PURCHASES_VOID,
    handler: (app, payload: { id: number; reason: string }) => {
      new PurchaseService(app.ctx()).void(payload.id, payload.reason)
      return { ok: true }
    }
  }),
  'purchases:returnableItems': route({
    permission: PERMISSIONS.PURCHASES_VIEW,
    handler: (app, payload: { purchaseId: number }) => new PurchaseService(app.ctx()).returnableItems(payload.purchaseId)
  }),
  'purchases:createReturn': route({
    permission: PERMISSIONS.PURCHASES_CREATE,
    handler: (app, payload: any) => new PurchaseService(app.ctx()).createReturn(payload)
  }),
  'purchases:returns': route({
    permission: PERMISSIONS.PURCHASES_VIEW,
    handler: (app, payload: { from?: string; to?: string; supplierId?: number } = {}) =>
      app.db
        .prepare(
          `SELECT r.*, p.name AS supplier_name FROM purchase_returns r JOIN parties p ON p.id = r.supplier_id
           WHERE (@from IS NULL OR r.date >= @from) AND (@to IS NULL OR r.date <= @to)
             AND (@supplierId IS NULL OR r.supplier_id = @supplierId)
           ORDER BY r.date DESC, r.id DESC LIMIT 500`
        )
        .all({ from: payload?.from ?? null, to: payload?.to ?? null, supplierId: payload?.supplierId ?? null })
  }),

  // ------------------------- المدفوعات -------------------------
  'payments:list': route({ permission: PERMISSIONS.PAYMENTS_VIEW, handler: (app, payload: any) => new PaymentService(app.ctx()).list(payload ?? {}) }),
  'payments:get': route({ permission: PERMISSIONS.PAYMENTS_VIEW, handler: (app, payload: { id: number }) => new PaymentService(app.ctx()).get(payload.id) }),
  'payments:create': route({ permission: PERMISSIONS.PAYMENTS_CREATE, handler: (app, payload: any) => new PaymentService(app.ctx()).create(payload) }),
  'payments:void': route({
    permission: PERMISSIONS.PAYMENTS_VOID,
    handler: (app, payload: { id: number; reason: string }) => {
      new PaymentService(app.ctx()).void(payload.id, payload.reason)
      return { ok: true }
    }
  }),
  'payments:openDocuments': route({
    permission: PERMISSIONS.PAYMENTS_VIEW,
    handler: (app, payload: { partyId: number }) => new PaymentService(app.ctx()).openDocuments(payload.partyId)
  }),
  'payments:methods': route({
    handler: (app, payload: { activeOnly?: boolean } = {}) => new PaymentService(app.ctx()).listMethods(payload?.activeOnly !== false)
  }),
  'payments:createMethod': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { name: string; accountId: number }) => new PaymentService(app.ctx()).createMethod(payload.name, payload.accountId)
  }),
  'payments:updateMethod': route({
    permission: PERMISSIONS.SETTINGS_MANAGE,
    handler: (app, payload: { id: number; data: never }) => {
      new PaymentService(app.ctx()).updateMethod(payload.id, payload.data)
      return { ok: true }
    }
  }),
  'cash:create': route({
    permission: PERMISSIONS.PAYMENTS_CREATE,
    handler: (app, payload: any) => new PaymentService(app.ctx()).createCashTransaction(payload)
  }),
  'cash:list': route({
    permission: PERMISSIONS.PAYMENTS_VIEW,
    handler: (app, payload: any) => new PaymentService(app.ctx()).listCashTransactions(payload ?? {})
  }),
  'cash:void': route({
    permission: PERMISSIONS.PAYMENTS_VOID,
    handler: (app, payload: { id: number; reason: string }) => {
      new PaymentService(app.ctx()).voidCashTransaction(payload.id, payload.reason)
      return { ok: true }
    }
  }),

  // ------------------------- المصروفات -------------------------
  'expenses:list': route({ permission: PERMISSIONS.EXPENSES_VIEW, handler: (app, payload: any) => new ExpenseService(app.ctx()).list(payload ?? {}) }),
  'expenses:get': route({ permission: PERMISSIONS.EXPENSES_VIEW, handler: (app, payload: { id: number }) => new ExpenseService(app.ctx()).get(payload.id) }),
  'expenses:create': route({ permission: PERMISSIONS.EXPENSES_MANAGE, handler: (app, payload: any) => new ExpenseService(app.ctx()).create(payload) }),
  'expenses:void': route({
    permission: PERMISSIONS.EXPENSES_MANAGE,
    handler: (app, payload: { id: number; reason: string }) => {
      new ExpenseService(app.ctx()).void(payload.id, payload.reason)
      return { ok: true }
    }
  }),
  'expenses:categories': route({
    permission: PERMISSIONS.EXPENSES_VIEW,
    handler: (app, payload: { activeOnly?: boolean } = {}) => new ExpenseService(app.ctx()).listCategories(payload?.activeOnly)
  }),
  'expenses:createCategory': route({
    permission: PERMISSIONS.EXPENSES_MANAGE,
    handler: (app, payload: { name: string; accountId?: number }) => new ExpenseService(app.ctx()).createCategory(payload.name, payload.accountId)
  }),
  'expenses:updateCategory': route({
    permission: PERMISSIONS.EXPENSES_MANAGE,
    handler: (app, payload: { id: number; data: never }) => {
      new ExpenseService(app.ctx()).updateCategory(payload.id, payload.data)
      return { ok: true }
    }
  }),
  'expenses:deleteCategory': route({
    permission: PERMISSIONS.EXPENSES_MANAGE,
    handler: (app, payload: { id: number }) => {
      new ExpenseService(app.ctx()).deleteCategory(payload.id)
      return { ok: true }
    }
  }),
  'expenses:byCategory': route({
    permission: PERMISSIONS.REPORTS_VIEW,
    handler: (app, payload: { from: string; to: string }) => new ExpenseService(app.ctx()).byCategory(payload.from, payload.to)
  }),

  // ------------------------- الإنتاج -------------------------
  'production:list': route({ permission: PERMISSIONS.PRODUCTION_VIEW, handler: (app, payload: any) => new ProductionService(app.ctx()).list(payload ?? {}) }),
  'production:get': route({ permission: PERMISSIONS.PRODUCTION_VIEW, handler: (app, payload: { id: number }) => new ProductionService(app.ctx()).get(payload.id) }),
  'production:create': route({ permission: PERMISSIONS.PRODUCTION_MANAGE, handler: (app, payload: any) => new ProductionService(app.ctx()).create(payload) }),
  'production:update': route({
    permission: PERMISSIONS.PRODUCTION_MANAGE,
    handler: (app, payload: { id: number; data: never }) => {
      new ProductionService(app.ctx()).updateHeader(payload.id, payload.data)
      return { ok: true }
    }
  }),
  'production:setStatus': route({
    permission: PERMISSIONS.PRODUCTION_MANAGE,
    handler: (app, payload: { id: number; status: never; reason?: string }) => {
      new ProductionService(app.ctx()).setStatus(payload.id, payload.status, payload.reason)
      return { ok: true }
    }
  }),
  'production:issueMaterials': route({
    permission: PERMISSIONS.PRODUCTION_MANAGE,
    handler: (app, payload: any) => {
      new ProductionService(app.ctx()).issueMaterials(payload)
      return { ok: true }
    }
  }),
  'production:addCost': route({
    permission: PERMISSIONS.PRODUCTION_MANAGE,
    handler: (app, payload: any) => new ProductionService(app.ctx()).addCost(payload)
  }),
  'production:voidCost': route({
    permission: PERMISSIONS.PRODUCTION_MANAGE,
    handler: (app, payload: { costId: number; reason: string }) => {
      new ProductionService(app.ctx()).voidCost(payload.costId, payload.reason)
      return { ok: true }
    }
  }),
  'production:receiveOutput': route({
    permission: PERMISSIONS.PRODUCTION_MANAGE,
    handler: (app, payload: any) => new ProductionService(app.ctx()).receiveOutput(payload)
  }),
  'production:factoriesWip': route({
    permission: PERMISSIONS.PRODUCTION_VIEW,
    handler: (app) => new ProductionService(app.ctx()).materialsAtFactories()
  })
}
