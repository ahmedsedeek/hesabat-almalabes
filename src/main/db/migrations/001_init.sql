-- =============================================================
-- 001_init — المخطط الأساسي لقاعدة البيانات
-- كل المبالغ المالية تُخزَّن كأعداد صحيحة بالوحدة الصغرى (قرش/فلس) — المقياس 100
-- كل الأسعار وتكاليف الوحدة تُخزَّن كأعداد صحيحة بمقياس 10000 (٤ خانات عشرية)
-- الكميات تُخزَّن كأعداد عشرية REAL بدقة ٣ خانات
-- التواريخ نصية بصيغة ISO: 'YYYY-MM-DD' أو 'YYYY-MM-DDTHH:MM:SS.sssZ'
-- =============================================================

-- ------------------------- الإعدادات -------------------------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------- المستخدمون والصلاحيات -------------------
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE role_permissions (
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  email         TEXT,
  phone         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  last_login_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_role ON users(role_id);

CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  user_id      INTEGER REFERENCES users(id),
  user_name    TEXT,
  action       TEXT NOT NULL,          -- create | update | void | delete | login | logout | restore | backup | settings
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  entity_label TEXT,
  old_value    TEXT,                   -- JSON
  new_value    TEXT,                   -- JSON
  reason       TEXT,
  device       TEXT,
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);

-- --------------------- ترقيم المستندات ----------------------
CREATE TABLE number_sequences (
  doc_type      TEXT PRIMARY KEY,      -- sale | purchase | payment_in | ...
  prefix        TEXT NOT NULL DEFAULT '',
  include_year  INTEGER NOT NULL DEFAULT 1 CHECK (include_year IN (0,1)),
  padding       INTEGER NOT NULL DEFAULT 6,
  separator     TEXT NOT NULL DEFAULT '-',
  next_number   INTEGER NOT NULL DEFAULT 1,
  reset_period  TEXT NOT NULL DEFAULT 'yearly' CHECK (reset_period IN ('never','yearly')),
  current_period TEXT
);

-- ------------------------ شجرة الحسابات ----------------------
CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  name_en     TEXT,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  subtype     TEXT,     -- cash | bank | receivable | payable | inventory | wip | cogs | tax | other
  parent_id   INTEGER REFERENCES accounts(id),
  system_key  TEXT UNIQUE,  -- مفتاح ثابت تستخدمه الشيفرة للحسابات الأساسية
  is_group    INTEGER NOT NULL DEFAULT 0 CHECK (is_group IN (0,1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accounts_parent ON accounts(parent_id);
CREATE INDEX idx_accounts_type ON accounts(type);

-- ------------------------ الأطراف ---------------------------
CREATE TABLE parties (
  id              INTEGER PRIMARY KEY,
  party_type      TEXT NOT NULL CHECK (party_type IN ('customer','supplier','factory')),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  company_name    TEXT,
  phone           TEXT,
  whatsapp        TEXT,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  tax_number      TEXT,
  commercial_reg  TEXT,
  contact_person  TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,   -- بالوحدة الصغرى، موجب = مدين للعميل / دائن للمورد
  opening_date    TEXT,
  credit_limit    INTEGER NOT NULL DEFAULT 0,
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      INTEGER REFERENCES users(id),
  UNIQUE (party_type, code)
);
CREATE INDEX idx_parties_type_name ON parties(party_type, name);
CREATE INDEX idx_parties_phone ON parties(phone);

-- ------------------------ المنتجات --------------------------
CREATE TABLE product_categories (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  parent_id  INTEGER REFERENCES product_categories(id),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id            INTEGER PRIMARY KEY,
  sku           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  product_type  TEXT NOT NULL DEFAULT 'finished' CHECK (product_type IN ('finished','raw','service')),
  category_id   INTEGER REFERENCES product_categories(id),
  brand         TEXT,
  unit          TEXT NOT NULL DEFAULT 'قطعة',
  description   TEXT,
  image_path    TEXT,
  track_inventory INTEGER NOT NULL DEFAULT 1 CHECK (track_inventory IN (0,1)),
  has_variants  INTEGER NOT NULL DEFAULT 0 CHECK (has_variants IN (0,1)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id)
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_type ON products(product_type);

-- كل منتج له متغيّر واحد على الأقل؛ المخزون يُتابَع دائمًا على مستوى المتغيّر
CREATE TABLE product_variants (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL UNIQUE,
  size          TEXT,
  color         TEXT,
  barcode       TEXT,
  purchase_price INTEGER NOT NULL DEFAULT 0,   -- مقياس 10000
  sale_price    INTEGER NOT NULL DEFAULT 0,    -- مقياس 10000
  avg_cost      INTEGER NOT NULL DEFAULT 0,    -- متوسط التكلفة المتحرك، مقياس 10000
  min_stock     REAL NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE UNIQUE INDEX idx_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL AND barcode <> '';

-- ------------------------ المخازن --------------------------
CREATE TABLE warehouses (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  address    TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stock_levels (
  variant_id   INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  quantity     REAL NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (variant_id, warehouse_id)
);

CREATE TABLE stock_movements (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,
  variant_id    INTEGER NOT NULL REFERENCES product_variants(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN (
                  'purchase','purchase_return','sale','sale_return','adjustment',
                  'transfer_in','transfer_out','production_issue','production_receipt',
                  'production_return','opening','damage')),
  qty_in        REAL NOT NULL DEFAULT 0,
  qty_out       REAL NOT NULL DEFAULT 0,
  unit_cost     INTEGER NOT NULL DEFAULT 0,  -- مقياس 10000
  value         INTEGER NOT NULL DEFAULT 0,  -- بالوحدة الصغرى، موجب = دخول قيمة، سالب = خروج قيمة
  balance_after REAL NOT NULL DEFAULT 0,     -- رصيد المتغيّر في هذا المخزن بعد الحركة
  avg_cost_after INTEGER NOT NULL DEFAULT 0, -- مقياس 10000
  ref_type      TEXT NOT NULL,
  ref_id        INTEGER,
  ref_number    TEXT,
  notes         TEXT,
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_moves_variant_date ON stock_movements(variant_id, date, id);
CREATE INDEX idx_moves_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX idx_moves_date ON stock_movements(date);
CREATE INDEX idx_moves_warehouse ON stock_movements(warehouse_id, date);

-- --------------------- القيود المحاسبية ---------------------
CREATE TABLE journal_entries (
  id           INTEGER PRIMARY KEY,
  entry_number TEXT NOT NULL UNIQUE,
  date         TEXT NOT NULL,
  ref_type     TEXT NOT NULL,   -- sale | purchase | payment | expense | production | opening | adjustment | manual
  ref_id       INTEGER,
  ref_number   TEXT,
  description  TEXT,
  is_void      INTEGER NOT NULL DEFAULT 0 CHECK (is_void IN (0,1)),
  void_reason  TEXT,
  voided_at    TEXT,
  voided_by    INTEGER REFERENCES users(id),
  reverses_entry_id INTEGER REFERENCES journal_entries(id),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_je_date ON journal_entries(date);
CREATE INDEX idx_je_ref ON journal_entries(ref_type, ref_id);

CREATE TABLE journal_lines (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  party_id    INTEGER REFERENCES parties(id),
  debit       INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description TEXT,
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX idx_jl_account ON journal_lines(account_id);
CREATE INDEX idx_jl_party ON journal_lines(party_id);

-- ------------------------ المبيعات --------------------------
CREATE TABLE sales (
  id              INTEGER PRIMARY KEY,
  invoice_number  TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL,
  due_date        TEXT,
  customer_id     INTEGER NOT NULL REFERENCES parties(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  subtotal        INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount      INTEGER NOT NULL DEFAULT 0,
  shipping_amount INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  paid_amount     INTEGER NOT NULL DEFAULT 0,   -- مخزَّن مؤقتًا، مصدره payment_allocations
  returned_amount INTEGER NOT NULL DEFAULT 0,
  cogs_amount     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft','confirmed','void')),
  notes           TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  void_reason     TEXT,
  voided_at       TEXT,
  voided_by       INTEGER REFERENCES users(id),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sales_date ON sales(date);
CREATE INDEX idx_sales_customer ON sales(customer_id, date);
CREATE INDEX idx_sales_status ON sales(status);

CREATE TABLE sale_items (
  id          INTEGER PRIMARY KEY,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  description TEXT,
  quantity    REAL NOT NULL CHECK (quantity > 0),
  unit_price  INTEGER NOT NULL DEFAULT 0,   -- مقياس 10000
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_rate    REAL NOT NULL DEFAULT 0,
  tax_amount  INTEGER NOT NULL DEFAULT 0,
  line_total  INTEGER NOT NULL DEFAULT 0,
  unit_cost   INTEGER NOT NULL DEFAULT 0,   -- تكلفة الوحدة وقت البيع، مقياس 10000
  cogs_amount INTEGER NOT NULL DEFAULT 0,
  returned_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_variant ON sale_items(variant_id);

CREATE TABLE sales_returns (
  id             INTEGER PRIMARY KEY,
  return_number  TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  sale_id        INTEGER REFERENCES sales(id),
  customer_id    INTEGER NOT NULL REFERENCES parties(id),
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  subtotal       INTEGER NOT NULL DEFAULT 0,
  tax_amount     INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  cogs_amount    INTEGER NOT NULL DEFAULT 0,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  void_reason    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sret_customer ON sales_returns(customer_id, date);

CREATE TABLE sales_return_items (
  id          INTEGER PRIMARY KEY,
  return_id   INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  sale_item_id INTEGER REFERENCES sale_items(id),
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  quantity    REAL NOT NULL CHECK (quantity > 0),
  unit_price  INTEGER NOT NULL DEFAULT 0,
  tax_amount  INTEGER NOT NULL DEFAULT 0,
  line_total  INTEGER NOT NULL DEFAULT 0,
  unit_cost   INTEGER NOT NULL DEFAULT 0,
  cogs_amount INTEGER NOT NULL DEFAULT 0
);

-- ------------------------ المشتريات -------------------------
CREATE TABLE purchases (
  id              INTEGER PRIMARY KEY,
  invoice_number  TEXT NOT NULL UNIQUE,
  supplier_invoice_number TEXT,
  date            TEXT NOT NULL,
  due_date        TEXT,
  supplier_id     INTEGER NOT NULL REFERENCES parties(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  purchase_type   TEXT NOT NULL DEFAULT 'goods' CHECK (purchase_type IN ('goods','materials')),
  subtotal        INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount      INTEGER NOT NULL DEFAULT 0,
  shipping_amount INTEGER NOT NULL DEFAULT 0,   -- يُوزَّع على تكلفة الأصناف
  other_cost_amount INTEGER NOT NULL DEFAULT 0, -- يُوزَّع على تكلفة الأصناف
  total           INTEGER NOT NULL DEFAULT 0,
  paid_amount     INTEGER NOT NULL DEFAULT 0,
  returned_amount INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft','confirmed','void')),
  notes           TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  void_reason     TEXT,
  voided_at       TEXT,
  voided_by       INTEGER REFERENCES users(id),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_purchases_date ON purchases(date);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id, date);

CREATE TABLE purchase_items (
  id          INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  description TEXT,
  quantity    REAL NOT NULL CHECK (quantity > 0),
  unit_price  INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_rate    REAL NOT NULL DEFAULT 0,
  tax_amount  INTEGER NOT NULL DEFAULT 0,
  line_total  INTEGER NOT NULL DEFAULT 0,
  landed_cost INTEGER NOT NULL DEFAULT 0,  -- نصيب السطر من الشحن والتكاليف الأخرى
  unit_cost   INTEGER NOT NULL DEFAULT 0,  -- التكلفة النهائية للوحدة بعد التوزيع، مقياس 10000
  returned_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_variant ON purchase_items(variant_id);

CREATE TABLE purchase_returns (
  id             INTEGER PRIMARY KEY,
  return_number  TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  purchase_id    INTEGER REFERENCES purchases(id),
  supplier_id    INTEGER NOT NULL REFERENCES parties(id),
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  subtotal       INTEGER NOT NULL DEFAULT 0,
  tax_amount     INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  void_reason    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_return_items (
  id          INTEGER PRIMARY KEY,
  return_id   INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  purchase_item_id INTEGER REFERENCES purchase_items(id),
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  quantity    REAL NOT NULL CHECK (quantity > 0),
  unit_price  INTEGER NOT NULL DEFAULT 0,
  tax_amount  INTEGER NOT NULL DEFAULT 0,
  line_total  INTEGER NOT NULL DEFAULT 0,
  unit_cost   INTEGER NOT NULL DEFAULT 0
);

-- --------------------- المدفوعات والمقبوضات ------------------
CREATE TABLE payment_methods (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id             INTEGER PRIMARY KEY,
  payment_number TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('in','out')),
  party_id       INTEGER REFERENCES parties(id),
  party_type     TEXT CHECK (party_type IN ('customer','supplier','factory')),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  method_id      INTEGER NOT NULL REFERENCES payment_methods(id),
  account_id     INTEGER NOT NULL REFERENCES accounts(id),  -- الصندوق/البنك المتأثر
  reference      TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  void_reason    TEXT,
  voided_at      TEXT,
  voided_by      INTEGER REFERENCES users(id),
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_date ON payments(date);
CREATE INDEX idx_payments_party ON payments(party_id, date);

CREATE TABLE payment_allocations (
  id         INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  doc_type   TEXT NOT NULL CHECK (doc_type IN ('sale','purchase','production_order')),
  doc_id     INTEGER NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0)
);
CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX idx_alloc_doc ON payment_allocations(doc_type, doc_id);

-- حركات الخزينة والبنك المستقلة (إيداع / سحب / تحويل)
CREATE TABLE cash_transactions (
  id           INTEGER PRIMARY KEY,
  trx_number   TEXT NOT NULL UNIQUE,
  date         TEXT NOT NULL,
  trx_type     TEXT NOT NULL CHECK (trx_type IN ('deposit','withdraw','transfer')),
  from_account_id INTEGER REFERENCES accounts(id),
  to_account_id   INTEGER REFERENCES accounts(id),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  void_reason  TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------ المصروفات -------------------------
CREATE TABLE expense_categories (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes      TEXT
);

CREATE TABLE expenses (
  id             INTEGER PRIMARY KEY,
  expense_number TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  category_id    INTEGER NOT NULL REFERENCES expense_categories(id),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  tax_amount     INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,
  payment_account_id INTEGER REFERENCES accounts(id),  -- NULL = مصروف آجل على طرف
  party_id       INTEGER REFERENCES parties(id),
  method_id      INTEGER REFERENCES payment_methods(id),
  description    TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  void_reason    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_category ON expenses(category_id, date);

-- --------------------- التصنيع وأوامر الإنتاج ----------------
CREATE TABLE production_orders (
  id              INTEGER PRIMARY KEY,
  order_number    TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL,
  factory_id      INTEGER NOT NULL REFERENCES parties(id),
  output_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  expected_qty    REAL NOT NULL CHECK (expected_qty > 0),
  produced_qty    REAL NOT NULL DEFAULT 0,
  expected_date   TEXT,
  completion_date TEXT,
  materials_cost  INTEGER NOT NULL DEFAULT 0,
  factory_cost    INTEGER NOT NULL DEFAULT 0,
  other_cost      INTEGER NOT NULL DEFAULT 0,
  total_cost      INTEGER NOT NULL DEFAULT 0,
  unit_cost       INTEGER NOT NULL DEFAULT 0,   -- مقياس 10000
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','in_production','partial','completed','cancelled')),
  notes           TEXT,
  void_reason     TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_prod_factory ON production_orders(factory_id, date);
CREATE INDEX idx_prod_status ON production_orders(status);

CREATE TABLE production_materials (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  planned_qty REAL NOT NULL DEFAULT 0,
  issued_qty  REAL NOT NULL DEFAULT 0,
  returned_qty REAL NOT NULL DEFAULT 0,
  issued_cost INTEGER NOT NULL DEFAULT 0,
  notes       TEXT
);
CREATE INDEX idx_prodmat_order ON production_materials(order_id);

CREATE TABLE production_issues (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  quantity    REAL NOT NULL,       -- موجب = صرف للمصنع، سالب = ارتجاع من المصنع
  unit_cost   INTEGER NOT NULL DEFAULT 0,
  value       INTEGER NOT NULL DEFAULT 0,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE production_outputs (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  quantity    REAL NOT NULL CHECK (quantity > 0),
  unit_cost   INTEGER NOT NULL DEFAULT 0,
  total_cost  INTEGER NOT NULL DEFAULT 0,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE production_costs (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  cost_type   TEXT NOT NULL CHECK (cost_type IN ('factory','other')),
  description TEXT,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  party_id    INTEGER REFERENCES parties(id),
  payment_account_id INTEGER REFERENCES accounts(id),  -- NULL = آجل على المصنع
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_prodcost_order ON production_costs(order_id);

-- --------------------- تسويات المخزون -----------------------
CREATE TABLE stock_adjustments (
  id             INTEGER PRIMARY KEY,
  adjustment_number TEXT NOT NULL UNIQUE,
  date           TEXT NOT NULL,
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('count','damage','loss','opening','other')),
  reason         TEXT,
  total_value    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stock_adjustment_items (
  id            INTEGER PRIMARY KEY,
  adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  variant_id    INTEGER NOT NULL REFERENCES product_variants(id),
  quantity      REAL NOT NULL,   -- موجب = زيادة، سالب = نقص
  unit_cost     INTEGER NOT NULL DEFAULT 0,
  value         INTEGER NOT NULL DEFAULT 0,
  notes         TEXT
);

CREATE TABLE stock_transfers (
  id              INTEGER PRIMARY KEY,
  transfer_number TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL,
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  to_warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','void')),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE stock_transfer_items (
  id          INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  quantity    REAL NOT NULL CHECK (quantity > 0),
  unit_cost   INTEGER NOT NULL DEFAULT 0
);

-- ------------------------ المرفقات --------------------------
CREATE TABLE attachments (
  id          INTEGER PRIMARY KEY,
  ref_type    TEXT NOT NULL,
  ref_id      INTEGER NOT NULL,
  file_name   TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type   TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attach_ref ON attachments(ref_type, ref_id);

-- --------------- النسخ الاحتياطي والإشعارات -----------------
CREATE TABLE backup_records (
  id           INTEGER PRIMARY KEY,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  backup_type  TEXT NOT NULL CHECK (backup_type IN ('manual','scheduled','pre_migration','pre_restore')),
  destination  TEXT NOT NULL CHECK (destination IN ('local','cloud')),
  provider     TEXT,
  file_name    TEXT NOT NULL,
  file_path    TEXT,
  remote_id    TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  checksum     TEXT,
  encrypted    INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0,1)),
  status       TEXT NOT NULL CHECK (status IN ('success','failed','in_progress')),
  error_message TEXT,
  app_version  TEXT,
  schema_version INTEGER
);
CREATE INDEX idx_backups_created ON backup_records(created_at DESC);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title      TEXT NOT NULL,
  body       TEXT,
  ref_type   TEXT,
  ref_id     INTEGER,
  dedupe_key TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  read_at    TEXT
);
CREATE INDEX idx_notif_unread ON notifications(is_read, created_at DESC);
CREATE UNIQUE INDEX idx_notif_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
