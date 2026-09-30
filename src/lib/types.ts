// ─── Core domain types for Phone man POS ──────────────────────────────────────

export type ID = string

export type Role = 'admin' | 'manager' | 'cashier'

export type Permission =
  | 'sell'
  | 'refund'
  | 'discount'
  | 'price_override'
  | 'void'
  | 'cash_drawer'
  | 'reports'
  | 'catalog'
  | 'inventory'
  | 'customers'
  | 'staff'
  | 'settings'

export interface User {
  id: ID
  name: string
  role: Role
  email: string
  pin: string // 4-6 digits, used for cashier login
  password?: string // admin/manager login
  color: string // avatar color
  active: boolean
  permissions: Permission[]
  createdAt: string
  lastLoginAt?: string
  phone?: string
}

export interface Category {
  id: ID
  name: string
  color: string
  icon: string // lucide icon name (informational) or emoji
  sortOrder: number
}

export interface Brand {
  id: ID
  name: string
}

export interface Supplier {
  id: ID
  name: string
  contactName?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  createdAt: string
}

export interface ProductVariantAttr {
  storage?: string
  color?: string
  size?: string
  condition?: 'new' | 'refurbished' | 'open-box'
}

export interface Product {
  id: ID
  sku: string
  barcode: string
  name: string
  brandId: ID
  categoryId: ID
  supplierId?: ID
  description?: string
  price: number // selling price (tax exclusive)
  cost: number // purchase cost
  taxable: boolean
  stock: number
  lowStockThreshold: number
  trackSerial: boolean // IMEI / serial numbers
  serials: string[] // available (unsold) serial numbers
  attrs: ProductVariantAttr
  emoji: string // visual stand-in for product image
  image?: string
  active: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
  soldCount: number
}

export interface Customer {
  id: ID
  name: string
  phone: string
  email?: string
  notes?: string
  loyaltyPoints: number
  storeCredit: number
  totalSpent: number
  visits: number
  tags: string[]
  createdAt: string
  lastVisitAt?: string
  address?: string
  birthday?: string
}

export interface Register {
  id: ID
  name: string // "Register 1"
  location: string
  active: boolean
  color: string
}

export interface CashMovement {
  id: ID
  type: 'in' | 'out'
  amount: number
  reason: string
  userId: ID
  createdAt: string
}

export type ShiftStatus = 'open' | 'closed'

export interface Shift {
  id: ID
  registerId: ID
  userId: ID
  status: ShiftStatus
  openedAt: string
  closedAt?: string
  openingFloat: number
  closingCount?: number
  expectedCash?: number
  difference?: number
  cashMovements: CashMovement[]
  notes?: string
  salesTotal: number
  salesCount: number
  refundsTotal: number
  refundsCount: number
  cashSales: number
  cardSales: number
  otherSales: number
}

export interface LineDiscount {
  type: 'percent' | 'fixed'
  value: number
  reason?: string
}

export interface CartLine {
  id: ID
  productId: ID
  name: string
  sku: string
  emoji: string
  unitPrice: number // possibly overridden
  originalPrice: number
  qty: number
  discount?: LineDiscount
  taxable: boolean
  serial?: string
  note?: string
  isRefund?: boolean
}

export interface Cart {
  id: ID
  registerId: ID
  userId: ID
  customerId?: ID
  lines: CartLine[]
  discount?: LineDiscount
  promoCode?: string
  note?: string
  label?: string
  heldAt?: string
  createdAt: string
  updatedAt: string
}

export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'store_credit' | 'gift_card' | 'bank_transfer'

export interface Payment {
  id: ID
  method: PaymentMethod
  amount: number
  tendered?: number
  reference?: string
  cardLast4?: string
  createdAt: string
}

export type TransactionType = 'sale' | 'refund' | 'exchange' | 'void'
export type TransactionStatus = 'completed' | 'refunded' | 'partially_refunded' | 'voided'

export interface TransactionLine {
  id: ID
  productId: ID
  name: string
  sku: string
  emoji: string
  unitPrice: number
  originalPrice: number
  qty: number
  discount?: LineDiscount
  discountAmount: number
  taxable: boolean
  taxAmount: number
  lineTotal: number // after discount, incl. tax if applicable
  serial?: string
  refundedQty: number
  cost: number
}

export interface Transaction {
  id: ID
  number: string // PM-000123
  type: TransactionType
  status: TransactionStatus
  registerId: ID
  shiftId?: ID
  userId: ID
  customerId?: ID
  lines: TransactionLine[]
  subtotal: number // before discounts, ex tax
  discountTotal: number
  cartDiscount?: LineDiscount
  promoCode?: string
  taxTotal: number
  total: number
  payments: Payment[]
  change: number
  note?: string
  createdAt: string
  refundOf?: ID
  loyaltyEarned: number
  loyaltyRedeemed: number
  costTotal: number
  voidedAt?: string
  voidReason?: string
}

export type StockMovementType =
  | 'sale'
  | 'refund'
  | 'purchase'
  | 'adjustment'
  | 'damage'
  | 'return_to_supplier'
  | 'initial'
  | 'transfer'
  | 'count'

export interface StockMovement {
  id: ID
  productId: ID
  type: StockMovementType
  qty: number // signed
  before: number
  after: number
  reason?: string
  refId?: ID
  userId: ID
  createdAt: string
  serial?: string
}

export type ActivitySeverity = 'info' | 'warning' | 'critical'

export interface ActivityLog {
  id: ID
  userId: ID
  userName: string
  action: string // e.g. sale.completed
  entity: string // transaction | product | ...
  entityId?: ID
  description: string
  meta?: Record<string, unknown>
  registerId?: ID
  severity: ActivitySeverity
  createdAt: string
}

export type PromotionType = 'percent' | 'fixed' | 'bogo' | 'bundle'
export type PromotionScope = 'all' | 'category' | 'product'

export interface Promotion {
  id: ID
  name: string
  code?: string
  type: PromotionType
  value: number
  scope: PromotionScope
  targetIds: ID[]
  minQty?: number
  startsAt: string
  endsAt: string
  active: boolean
  usageCount: number
  description?: string
}

export type POStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled'

export interface POLine {
  id: ID
  productId: ID
  qty: number
  cost: number
  received: number
}

export interface PurchaseOrder {
  id: ID
  number: string
  supplierId: ID
  lines: POLine[]
  status: POStatus
  createdAt: string
  expectedAt?: string
  receivedAt?: string
  userId: ID
  notes?: string
}

export type RepairStatus =
  | 'received'
  | 'diagnosing'
  | 'waiting_parts'
  | 'in_progress'
  | 'ready'
  | 'collected'
  | 'cancelled'

export interface RepairNote {
  id: ID
  userId: ID
  text: string
  createdAt: string
}

export interface RepairTicket {
  id: ID
  number: string
  customerId: ID
  device: string
  imei?: string
  issue: string
  status: RepairStatus
  estimate: number
  deposit: number
  technicianId?: ID
  createdAt: string
  updatedAt: string
  promisedAt?: string
  notes: RepairNote[]
  paid: boolean
}

export type AlertType =
  | 'low_stock'
  | 'out_of_stock'
  | 'shift_variance'
  | 'large_refund'
  | 'large_discount'
  | 'void'
  | 'po_received'
  | 'repair_ready'
  | 'system'
  | 'price_override'

export interface Alert {
  id: ID
  type: AlertType
  title: string
  message: string
  severity: ActivitySeverity
  read: boolean
  createdAt: string
  link?: string
}

export interface Settings {
  storeName: string
  tagline: string
  address: string
  phone: string
  email: string
  website: string
  currency: string
  currencySymbol: string
  locale: string
  taxRate: number // percent
  taxName: string
  taxInclusive: boolean
  receiptHeader: string
  receiptFooter: string
  loyaltyPointsPerCurrency: number // points earned per 1 currency unit
  loyaltyPointValue: number // value of one point in currency
  lowStockDefault: number
  cashierMaxDiscountPercent: number
  requireManagerForRefund: boolean
  requireManagerForVoid: boolean
  largeRefundThreshold: number
  largeDiscountThreshold: number
  displayIdleMessages: string[]
  displayShowPromotions: boolean
  displayAccent: string
  autoPrintReceipt: boolean
  openingFloatDefault: number
  numberPrefix: string
  nextTransactionNumber: number
  nextPONumber: number
  nextRepairNumber: number
}

export type DisplayPhase = 'idle' | 'cart' | 'payment' | 'complete'

export interface DisplayState {
  registerId: ID
  phase: DisplayPhase
  transactionId?: ID
  message?: string
  updatedAt: string
}

export interface Database {
  version: number
  seededAt: string
  users: User[]
  categories: Category[]
  brands: Brand[]
  suppliers: Supplier[]
  products: Product[]
  customers: Customer[]
  registers: Register[]
  shifts: Shift[]
  transactions: Transaction[]
  stockMovements: StockMovement[]
  activity: ActivityLog[]
  promotions: Promotion[]
  purchaseOrders: PurchaseOrder[]
  repairs: RepairTicket[]
  alerts: Alert[]
  settings: Settings
  carts: Cart[] // active + held carts (one active per register, many held)
  displays: DisplayState[]
}
