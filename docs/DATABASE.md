# مخطط قاعدة البيانات

الملف: `src/main/db/migrations/001_init.sql` — ولا يُعدَّل بعد النشر إطلاقًا.

## الاصطلاحات

| الاصطلاح | القاعدة |
|---|---|
| المبالغ | `INTEGER` بالوحدة الصغرى (`×100`) |
| الأسعار وتكاليف الوحدة | `INTEGER` بمقياس `×10000` |
| الكميات | `REAL` بدقة ٣ خانات |
| التواريخ | `TEXT` بصيغة `YYYY-MM-DD` بالتوقيت المحلي |
| أوقات الإنشاء | `TEXT` عبر `datetime('now')` |
| الحالة | `draft` · `confirmed` · `void` |
| المنطقي | `INTEGER` مع `CHECK (x IN (0,1))` |

## المجموعات

### النظام والمستخدمون
`settings` · `roles` · `role_permissions` · `users` · `audit_logs` · `number_sequences` · `notifications` · `backup_records`

### المحاسبة
`accounts` · `journal_entries` · `journal_lines`

- `accounts.system_key` مفتاح ثابت تستخدمه الشيفرة بدل رقم الحساب.
- `journal_lines` فيها `CHECK (debit = 0 OR credit = 0)` — سطر واحد لا يحمل الاتجاهين.
- `journal_lines.party_id` يربط السطر بالعميل/المورد، فتُشتقّ أرصدة الأطراف وكشوف الحسابات منه مباشرة.

### الأطراف والمنتجات
`parties` (عميل/مورد/مصنع في جدول واحد مع مُميِّز النوع) · `product_categories` · `products` · `product_variants`

- لكل منتج **متغيّر واحد على الأقل**؛ المخزون يُتابَع دائمًا على مستوى المتغيّر،
  فلا يوجد مسار مزدوج بين «منتج بلا مقاسات» و«منتج بمقاسات».

### المخزون
`warehouses` · `stock_levels` · `stock_movements` · `stock_adjustments` · `stock_adjustment_items` · `stock_transfers` · `stock_transfer_items`

- `stock_movements` سجل دائم لا يُحذف منه شيء، ويحفظ `balance_after` و`avg_cost_after`
  للتدقيق التاريخي.

### العمليات
`sales` · `sale_items` · `sales_returns` · `sales_return_items`
`purchases` · `purchase_items` · `purchase_returns` · `purchase_return_items`
`payments` · `payment_allocations` · `payment_methods` · `cash_transactions`
`expenses` · `expense_categories`
`production_orders` · `production_materials` · `production_issues` · `production_outputs` · `production_costs`

### أخرى
`attachments` · `schema_migrations`

## الحقول المخزَّنة مؤقتًا

ثلاثة حقول تُحفظ لتسريع القوائم رغم أنها مُشتقّة:

| الحقل | المصدر الحقيقي |
|---|---|
| `sales.paid_amount` / `purchases.paid_amount` | `payment_allocations` للسندات المؤكدة |
| `sales.returned_amount` / `purchases.returned_amount` | المردودات المؤكدة |
| `stock_levels.quantity` | مجموع `stock_movements` |

تُحدَّث داخل نفس معاملة العملية، و«فحص سلامة البيانات» يقارنها بمصدرها
و«الإصلاح» يعيد احتسابها. أي اختلاف يُعدّ خللًا يُبلَّغ عنه.

## الفهارس

مبنية على أنماط الاستعلام الفعلية: التاريخ، الطرف، الحالة، المرجع، والمتغيّر.
الأثر مقيس في `tests/performance.test.ts` على ١٠٠٬٠٠٠ فاتورة.

## الهجرات

```ts
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: init001 },
  { version: 2, name: 'retail_delivery', sql: retail002 }
]
```

### ما أضافته الهجرة ٢

| الجدول | الحقول |
|---|---|
| `sales` | `sale_channel` · `delivery_cost` · `delivery_party_id` · `delivery_payment_account_id` · `delivery_address` · `tracking_number` |
| `sales_returns` | `delivery_cost` · `delivery_party_id` · `delivery_payment_account_id` · `refunded_shipping` · `restock` |
| `sales_return_items` | `restock` |
| `accounts` | المفتاح الثابت `delivery_expense` للحساب 6040 |

- تعمل داخل معاملة واحدة، وتُسجَّل في `schema_migrations`.
- **لا تُعدَّل هجرة منشورة أبدًا** — أي تغيير يُضاف كهجرة جديدة برقم أعلى،
  حتى تعمل الترقية على قواعد البيانات القائمة لدى المستخدمين.
- عند الاستعادة يتحقق النظام أن إصدار مخطط النسخة ليس أحدث من إصدار التطبيق.

## البيانات الافتراضية

عند أول تشغيل تُنشأ: شجرة الحسابات · ٤ أدوار بصلاحياتها · ١٢ تسلسل ترقيم ·
٤ طرق دفع · ١٢ فئة مصروفات · المخزن الرئيسي · الإعدادات الافتراضية.
الدالة تتجاهل قاعدة بيانات مهيّأة مسبقًا فلا تتكرر البيانات.
