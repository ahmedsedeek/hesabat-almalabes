-- =============================================================
-- 002 — البيع للمستهلك (B2C) وتكلفة التوصيل والمردودات غير الصالحة للبيع
--
-- التمييز الجوهري الذي تضيفه هذه الهجرة:
--   shipping_amount = ما يدفعه العميل لنا مقابل الشحن  →  إيراد
--   delivery_cost   = ما ندفعه نحن لشركة الشحن          →  مصروف
-- فإن تحمّل العميل الشحن امتلأ الحقلان، وإن تحمّلناه نحن امتلأ الثاني وحده.
-- =============================================================

ALTER TABLE sales ADD COLUMN sale_channel TEXT NOT NULL DEFAULT 'wholesale'
  CHECK (sale_channel IN ('wholesale','retail','online'));

-- تكلفة التوصيل التي ندفعها لشركة الشحن (ليست جزءًا من إجمالي الفاتورة)
ALTER TABLE sales ADD COLUMN delivery_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN delivery_party_id INTEGER REFERENCES parties(id);
ALTER TABLE sales ADD COLUMN delivery_payment_account_id INTEGER REFERENCES accounts(id);
ALTER TABLE sales ADD COLUMN delivery_address TEXT;
ALTER TABLE sales ADD COLUMN tracking_number TEXT;

CREATE INDEX idx_sales_channel ON sales(sale_channel, date);

-- المردودات: تكلفة إرجاع الشحنة، وهل تعود البضاعة صالحة للبيع
ALTER TABLE sales_returns ADD COLUMN delivery_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_returns ADD COLUMN delivery_party_id INTEGER REFERENCES parties(id);
ALTER TABLE sales_returns ADD COLUMN delivery_payment_account_id INTEGER REFERENCES accounts(id);
ALTER TABLE sales_returns ADD COLUMN refunded_shipping INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_returns ADD COLUMN restock INTEGER NOT NULL DEFAULT 1 CHECK (restock IN (0,1));

ALTER TABLE sales_return_items ADD COLUMN restock INTEGER NOT NULL DEFAULT 1 CHECK (restock IN (0,1));

-- حساب مصروف التوصيل يحصل على مفتاح ثابت تستخدمه الشيفرة
UPDATE accounts SET system_key = 'delivery_expense' WHERE code = '6040' AND system_key IS NULL;
