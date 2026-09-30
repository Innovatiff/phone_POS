import { create } from 'zustand'
import { produce } from 'immer'
import type {
  Database, Product, Customer, User, Category, Brand, Supplier, Register, Shift, Cart, CartLine, LineDiscount, Payment,
  Transaction, StockMovementType, ActivityLog, ActivitySeverity, Promotion, PurchaseOrder, RepairTicket, RepairStatus,
  Alert, AlertType, Settings, DisplayPhase, ID, POStatus,
} from '@/lib/types'
import { buildSeed, DB_VERSION } from '@/data/seed'
import { calcCart, toTransactionLines } from '@/lib/pos'
import { configureCurrency, nowISO, pad, round2, uid } from '@/lib/utils'

const STORAGE_KEY = 'phoneman.pos.db'
const CHANNEL = 'phoneman-pos-sync'
const TAB_ID = uid('tab')

// ─── Persistence ─────────────────────────────────────────────────────────────
function load(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Database
      if (parsed && parsed.version === DB_VERSION) return parsed
    }
  } catch {
    /* ignore */
  }
  const db = buildSeed()
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)) } catch { /* ignore */ }
  return db
}

let channel: BroadcastChannel | null = null
try { channel = new BroadcastChannel(CHANNEL) } catch { channel = null }

let saveTimer: number | null = null
function persist(db: Database) {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
      channel?.postMessage({ type: 'db', from: TAB_ID })
    } catch (e) {
      console.error('persist failed', e)
    }
  }, 40)
}

// ─── Store ───────────────────────────────────────────────────────────────────
export interface CheckoutInput {
  registerId: ID
  userId: ID
  payments: Array<Omit<Payment, 'id' | 'createdAt'>>
  note?: string
  redeemPoints?: number
  approvedBy?: ID
}

export interface RefundInput {
  transactionId: ID
  registerId: ID
  userId: ID
  approvedBy?: ID
  lines: Array<{ lineId: ID; qty: number; restock: boolean }>
  method: Payment['method']
  reason: string
}

interface DBState {
  db: Database
  hydrate: () => void
  mutate: (fn: (db: Database) => void) => void
  // helpers
  log: (entry: Omit<ActivityLog, 'id' | 'createdAt' | 'userName'> & { userName?: string }) => void
  addAlert: (a: Omit<Alert, 'id' | 'createdAt' | 'read'>) => void
  // catalog
  upsertProduct: (p: Partial<Product> & { id?: ID }, userId: ID) => Product
  deleteProduct: (id: ID, userId: ID) => void
  bulkUpdateProducts: (ids: ID[], patch: Partial<Product>, userId: ID) => void
  upsertCategory: (c: Partial<Category> & { id?: ID }, userId: ID) => void
  deleteCategory: (id: ID, userId: ID) => void
  upsertBrand: (b: Partial<Brand> & { id?: ID }, userId: ID) => void
  deleteBrand: (id: ID, userId: ID) => void
  upsertSupplier: (s: Partial<Supplier> & { id?: ID }, userId: ID) => void
  deleteSupplier: (id: ID, userId: ID) => void
  // inventory
  adjustStock: (productId: ID, qty: number, type: StockMovementType, reason: string, userId: ID, refId?: ID, serials?: string[]) => void
  // customers
  upsertCustomer: (c: Partial<Customer> & { id?: ID }, userId: ID) => Customer
  deleteCustomer: (id: ID, userId: ID) => void
  adjustStoreCredit: (customerId: ID, amount: number, reason: string, userId: ID) => void
  // staff
  upsertUser: (u: Partial<User> & { id?: ID }, actorId: ID) => User
  deleteUser: (id: ID, actorId: ID) => void
  // registers & shifts
  upsertRegister: (r: Partial<Register> & { id?: ID }, userId: ID) => void
  openShift: (registerId: ID, userId: ID, openingFloat: number, notes?: string) => Shift
  closeShift: (shiftId: ID, closingCount: number, userId: ID, notes?: string) => Shift | undefined
  cashMovement: (shiftId: ID, type: 'in' | 'out', amount: number, reason: string, userId: ID) => void
  // carts
  getActiveCart: (registerId: ID, userId: ID) => Cart
  addToCart: (registerId: ID, userId: ID, productId: ID, qty?: number, serial?: string) => { ok: boolean; message?: string }
  updateLine: (registerId: ID, lineId: ID, patch: Partial<CartLine>) => void
  removeLine: (registerId: ID, lineId: ID) => void
  setCartDiscount: (registerId: ID, discount?: LineDiscount) => void
  setCartCustomer: (registerId: ID, customerId?: ID) => void
  setCartPromo: (registerId: ID, code?: string) => { ok: boolean; message?: string }
  setCartNote: (registerId: ID, note?: string) => void
  clearCart: (registerId: ID, userId: ID, reason?: string) => void
  holdCart: (registerId: ID, userId: ID, label?: string) => void
  recallCart: (registerId: ID, userId: ID, cartId: ID) => void
  deleteHeldCart: (cartId: ID, userId: ID) => void
  // checkout
  checkout: (input: CheckoutInput) => { ok: boolean; transaction?: Transaction; message?: string }
  refund: (input: RefundInput) => { ok: boolean; transaction?: Transaction; message?: string }
  voidTransaction: (transactionId: ID, userId: ID, reason: string, approvedBy?: ID) => { ok: boolean; message?: string }
  // display
  setDisplay: (registerId: ID, phase: DisplayPhase, extra?: { transactionId?: ID; message?: string }) => void
  // promotions
  upsertPromotion: (p: Partial<Promotion> & { id?: ID }, userId: ID) => void
  deletePromotion: (id: ID, userId: ID) => void
  // purchase orders
  upsertPurchaseOrder: (po: Partial<PurchaseOrder> & { id?: ID }, userId: ID) => PurchaseOrder
  setPOStatus: (id: ID, status: POStatus, userId: ID) => void
  receivePO: (id: ID, received: Record<ID, number>, userId: ID) => void
  deletePurchaseOrder: (id: ID, userId: ID) => void
  // repairs
  upsertRepair: (t: Partial<RepairTicket> & { id?: ID }, userId: ID) => RepairTicket
  setRepairStatus: (id: ID, status: RepairStatus, userId: ID, note?: string) => void
  addRepairNote: (id: ID, text: string, userId: ID) => void
  deleteRepair: (id: ID, userId: ID) => void
  // alerts
  markAlertRead: (id: ID, read?: boolean) => void
  markAllAlertsRead: () => void
  dismissAlert: (id: ID) => void
  // settings & data
  updateSettings: (patch: Partial<Settings>, userId: ID) => void
  resetDemo: () => void
  importDatabase: (db: Database) => boolean
  exportDatabase: () => string
}

export const useDB = create<DBState>((set, get) => {
  const initial = load()
  configureCurrency(initial.settings.locale, initial.settings.currency)

  const mutate: DBState['mutate'] = (fn) => {
    const next = produce(get().db, (draft) => { fn(draft) })
    if (next !== get().db) {
      set({ db: next })
      persist(next)
    }
  }

  const findUserName = (db: Database, userId: ID) => db.users.find((u) => u.id === userId)?.name ?? 'System'

  const pushLog = (db: Database, e: Omit<ActivityLog, 'id' | 'createdAt' | 'userName'> & { userName?: string }) => {
    db.activity.push({ ...e, id: uid('act'), createdAt: nowISO(), userName: e.userName ?? findUserName(db, e.userId) })
    if (db.activity.length > 5000) db.activity.splice(0, db.activity.length - 5000)
  }
  const pushAlert = (db: Database, a: Omit<Alert, 'id' | 'createdAt' | 'read'>) => {
    db.alerts.unshift({ ...a, id: uid('al'), createdAt: nowISO(), read: false })
    if (db.alerts.length > 300) db.alerts.length = 300
  }
  const checkStockAlerts = (db: Database, p: Product) => {
    if (p.categoryId === 'cat_service') return
    const type: AlertType | null = p.stock <= 0 ? 'out_of_stock' : p.stock <= p.lowStockThreshold ? 'low_stock' : null
    if (!type) return
    const dup = db.alerts.find((a) => a.type === type && !a.read && a.link === `/admin/catalog/${p.id}`)
    if (dup) return
    pushAlert(db, { type, title: type === 'out_of_stock' ? 'Out of stock' : 'Low stock', message: `${p.name} — ${p.stock} left (threshold ${p.lowStockThreshold})`, severity: type === 'out_of_stock' ? 'critical' : 'warning', link: `/admin/catalog/${p.id}` })
  }
  const moveStock = (db: Database, productId: ID, qty: number, type: StockMovementType, userId: ID, reason?: string, refId?: ID, serial?: string) => {
    const p = db.products.find((x) => x.id === productId)
    if (!p) return
    const before = p.stock
    p.stock = before + qty
    p.updatedAt = nowISO()
    db.stockMovements.push({ id: uid('sm'), productId, type, qty, before, after: p.stock, reason, refId, userId, createdAt: nowISO(), serial })
    checkStockAlerts(db, p)
  }
  const ensureActiveCart = (db: Database, registerId: ID, userId: ID): Cart => {
    let cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
    if (!cart) {
      cart = { id: uid('cart'), registerId, userId, lines: [], createdAt: nowISO(), updatedAt: nowISO() }
      db.carts.push(cart)
    }
    return cart
  }
  const touchDisplay = (db: Database, registerId: ID, phase: DisplayPhase, extra?: { transactionId?: ID; message?: string }) => {
    let d = db.displays.find((x) => x.registerId === registerId)
    if (!d) { d = { registerId, phase: 'idle', updatedAt: nowISO() }; db.displays.push(d) }
    d.phase = phase
    d.transactionId = extra?.transactionId
    d.message = extra?.message
    d.updatedAt = nowISO()
  }
  const autoPhase = (db: Database, registerId: ID) => {
    const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
    const d = db.displays.find((x) => x.registerId === registerId)
    if (d && d.phase !== 'payment' && d.phase !== 'complete') touchDisplay(db, registerId, cart && cart.lines.length ? 'cart' : 'idle')
    else if (d && (d.phase === 'complete') && cart && cart.lines.length) touchDisplay(db, registerId, 'cart')
  }

  return {
    db: initial,
    hydrate: () => {
      const fresh = load()
      configureCurrency(fresh.settings.locale, fresh.settings.currency)
      set({ db: fresh })
    },
    mutate,
    log: (e) => mutate((db) => pushLog(db, e)),
    addAlert: (a) => mutate((db) => pushAlert(db, a)),

    // ── Catalog ──────────────────────────────────────────────────────────
    upsertProduct: (p, userId) => {
      let result!: Product
      mutate((db) => {
        const existing = p.id ? db.products.find((x) => x.id === p.id) : undefined
        if (existing) {
          const before = { price: existing.price, stock: existing.stock, name: existing.name }
          Object.assign(existing, p, { updatedAt: nowISO() })
          if (p.stock !== undefined && p.stock !== before.stock) {
            const diff = p.stock - before.stock
            existing.stock = before.stock
            moveStock(db, existing.id, diff, 'adjustment', userId, 'Edited in catalog')
          }
          pushLog(db, { userId, action: 'product.updated', entity: 'product', entityId: existing.id, description: `Updated product ${existing.name}${before.price !== existing.price ? ` (price ${before.price} → ${existing.price})` : ''}`, severity: before.price !== existing.price ? 'warning' : 'info', meta: { before, after: { price: existing.price, stock: existing.stock, name: existing.name } } })
          result = existing
        } else {
          const id = p.id ?? uid('p')
          const np: Product = {
            id, sku: p.sku || `SKU-${pad(db.products.length + 1000, 4)}`, barcode: p.barcode || String(Date.now()).slice(-13), name: p.name || 'New product',
            brandId: p.brandId || db.brands[0]!.id, categoryId: p.categoryId || db.categories[0]!.id, supplierId: p.supplierId, description: p.description,
            price: p.price ?? 0, cost: p.cost ?? 0, taxable: p.taxable ?? true, stock: 0, lowStockThreshold: p.lowStockThreshold ?? db.settings.lowStockDefault,
            trackSerial: p.trackSerial ?? false, serials: p.serials ?? [], attrs: p.attrs ?? {}, emoji: p.emoji || '📦', image: p.image, active: p.active ?? true,
            tags: p.tags ?? [], createdAt: nowISO(), updatedAt: nowISO(), soldCount: 0,
          }
          db.products.push(np)
          if (p.stock) moveStock(db, id, p.stock, 'initial', userId, 'Initial stock')
          pushLog(db, { userId, action: 'product.created', entity: 'product', entityId: id, description: `Created product ${np.name} (${np.sku})`, severity: 'info' })
          result = np
        }
      })
      return result
    },
    deleteProduct: (id, userId) => mutate((db) => {
      const p = db.products.find((x) => x.id === id)
      if (!p) return
      db.products = db.products.filter((x) => x.id !== id)
      pushLog(db, { userId, action: 'product.deleted', entity: 'product', entityId: id, description: `Deleted product ${p.name} (${p.sku})`, severity: 'warning' })
    }),
    bulkUpdateProducts: (ids, patch, userId) => mutate((db) => {
      db.products.forEach((p) => { if (ids.includes(p.id)) Object.assign(p, patch, { updatedAt: nowISO() }) })
      pushLog(db, { userId, action: 'product.bulk_updated', entity: 'product', description: `Bulk updated ${ids.length} product(s): ${Object.keys(patch).join(', ')}`, severity: 'info' })
    }),
    upsertCategory: (c, userId) => mutate((db) => {
      const ex = c.id ? db.categories.find((x) => x.id === c.id) : undefined
      if (ex) Object.assign(ex, c)
      else db.categories.push({ id: uid('cat'), name: c.name || 'New category', color: c.color || '#64748b', icon: c.icon || '📦', sortOrder: db.categories.length + 1 })
      pushLog(db, { userId, action: ex ? 'category.updated' : 'category.created', entity: 'category', entityId: c.id, description: `${ex ? 'Updated' : 'Created'} category ${c.name ?? ex?.name}`, severity: 'info' })
    }),
    deleteCategory: (id, userId) => mutate((db) => {
      const c = db.categories.find((x) => x.id === id)
      if (!c) return
      const fallback = db.categories.find((x) => x.id !== id)
      if (fallback) db.products.forEach((p) => { if (p.categoryId === id) p.categoryId = fallback.id })
      db.categories = db.categories.filter((x) => x.id !== id)
      pushLog(db, { userId, action: 'category.deleted', entity: 'category', entityId: id, description: `Deleted category ${c.name}`, severity: 'warning' })
    }),
    upsertBrand: (b, userId) => mutate((db) => {
      const ex = b.id ? db.brands.find((x) => x.id === b.id) : undefined
      if (ex) Object.assign(ex, b)
      else db.brands.push({ id: uid('b'), name: b.name || 'New brand' })
      pushLog(db, { userId, action: ex ? 'brand.updated' : 'brand.created', entity: 'brand', entityId: b.id, description: `${ex ? 'Updated' : 'Created'} brand ${b.name}`, severity: 'info' })
    }),
    deleteBrand: (id, userId) => mutate((db) => {
      const b = db.brands.find((x) => x.id === id)
      if (!b) return
      const fallback = db.brands.find((x) => x.id !== id)
      if (fallback) db.products.forEach((p) => { if (p.brandId === id) p.brandId = fallback.id })
      db.brands = db.brands.filter((x) => x.id !== id)
      pushLog(db, { userId, action: 'brand.deleted', entity: 'brand', entityId: id, description: `Deleted brand ${b.name}`, severity: 'warning' })
    }),
    upsertSupplier: (s, userId) => mutate((db) => {
      const ex = s.id ? db.suppliers.find((x) => x.id === s.id) : undefined
      if (ex) Object.assign(ex, s)
      else db.suppliers.push({ id: uid('sup'), name: s.name || 'New supplier', contactName: s.contactName, phone: s.phone, email: s.email, address: s.address, notes: s.notes, createdAt: nowISO() })
      pushLog(db, { userId, action: ex ? 'supplier.updated' : 'supplier.created', entity: 'supplier', entityId: s.id, description: `${ex ? 'Updated' : 'Created'} supplier ${s.name ?? ex?.name}`, severity: 'info' })
    }),
    deleteSupplier: (id, userId) => mutate((db) => {
      const s = db.suppliers.find((x) => x.id === id)
      if (!s) return
      db.suppliers = db.suppliers.filter((x) => x.id !== id)
      db.products.forEach((p) => { if (p.supplierId === id) p.supplierId = undefined })
      pushLog(db, { userId, action: 'supplier.deleted', entity: 'supplier', entityId: id, description: `Deleted supplier ${s.name}`, severity: 'warning' })
    }),

    // ── Inventory ────────────────────────────────────────────────────────
    adjustStock: (productId, qty, type, reason, userId, refId, serials) => mutate((db) => {
      const p = db.products.find((x) => x.id === productId)
      if (!p) return
      moveStock(db, productId, qty, type, userId, reason, refId)
      if (p.trackSerial && serials?.length) {
        if (qty > 0) p.serials.push(...serials)
        else p.serials = p.serials.filter((s) => !serials.includes(s))
      }
      pushLog(db, { userId, action: `stock.${type}`, entity: 'product', entityId: productId, description: `${qty > 0 ? '+' : ''}${qty} × ${p.name} (${type.replace(/_/g, ' ')})${reason ? ` – ${reason}` : ''}`, severity: qty < 0 && type !== 'sale' ? 'warning' : 'info', meta: { qty, type, reason } })
    }),

    // ── Customers ────────────────────────────────────────────────────────
    upsertCustomer: (c, userId) => {
      let result!: Customer
      mutate((db) => {
        const ex = c.id ? db.customers.find((x) => x.id === c.id) : undefined
        if (ex) { Object.assign(ex, c); result = ex }
        else {
          const nc: Customer = { id: uid('c'), name: c.name || 'Walk-in customer', phone: c.phone || '', email: c.email, notes: c.notes, loyaltyPoints: c.loyaltyPoints ?? 0, storeCredit: c.storeCredit ?? 0, totalSpent: 0, visits: 0, tags: c.tags ?? [], createdAt: nowISO(), address: c.address, birthday: c.birthday }
          db.customers.push(nc)
          result = nc
        }
        pushLog(db, { userId, action: ex ? 'customer.updated' : 'customer.created', entity: 'customer', entityId: result.id, description: `${ex ? 'Updated' : 'Created'} customer ${result.name}`, severity: 'info' })
      })
      return result
    },
    deleteCustomer: (id, userId) => mutate((db) => {
      const c = db.customers.find((x) => x.id === id)
      if (!c) return
      db.customers = db.customers.filter((x) => x.id !== id)
      pushLog(db, { userId, action: 'customer.deleted', entity: 'customer', entityId: id, description: `Deleted customer ${c.name}`, severity: 'warning' })
    }),
    adjustStoreCredit: (customerId, amount, reason, userId) => mutate((db) => {
      const c = db.customers.find((x) => x.id === customerId)
      if (!c) return
      c.storeCredit = round2(c.storeCredit + amount)
      pushLog(db, { userId, action: 'customer.credit', entity: 'customer', entityId: customerId, description: `${amount >= 0 ? 'Added' : 'Removed'} ${Math.abs(amount).toFixed(2)} store credit for ${c.name} – ${reason}`, severity: 'info' })
    }),

    // ── Staff ────────────────────────────────────────────────────────────
    upsertUser: (u, actorId) => {
      let result!: User
      mutate((db) => {
        const ex = u.id ? db.users.find((x) => x.id === u.id) : undefined
        if (ex) { Object.assign(ex, u); result = ex }
        else {
          const nu: User = { id: uid('u'), name: u.name || 'New staff', role: u.role || 'cashier', email: u.email || '', pin: u.pin || '1234', password: u.password, color: u.color || '#2563eb', active: u.active ?? true, permissions: u.permissions ?? ['sell', 'customers'], createdAt: nowISO(), phone: u.phone }
          db.users.push(nu)
          result = nu
        }
        pushLog(db, { userId: actorId, action: ex ? 'staff.updated' : 'staff.created', entity: 'user', entityId: result.id, description: `${ex ? 'Updated' : 'Created'} staff member ${result.name} (${result.role})`, severity: 'info' })
      })
      return result
    },
    deleteUser: (id, actorId) => mutate((db) => {
      const u = db.users.find((x) => x.id === id)
      if (!u || u.id === 'u_admin') return
      db.users = db.users.filter((x) => x.id !== id)
      pushLog(db, { userId: actorId, action: 'staff.deleted', entity: 'user', entityId: id, description: `Removed staff member ${u.name}`, severity: 'warning' })
    }),

    // ── Registers & shifts ───────────────────────────────────────────────
    upsertRegister: (r, userId) => mutate((db) => {
      const ex = r.id ? db.registers.find((x) => x.id === r.id) : undefined
      if (ex) Object.assign(ex, r)
      else {
        const id = uid('reg')
        db.registers.push({ id, name: r.name || `Register ${db.registers.length + 1}`, location: r.location || '', active: r.active ?? true, color: r.color || '#2563eb' })
        db.displays.push({ registerId: id, phase: 'idle', updatedAt: nowISO() })
      }
      pushLog(db, { userId, action: ex ? 'register.updated' : 'register.created', entity: 'register', entityId: r.id, description: `${ex ? 'Updated' : 'Created'} ${r.name ?? ex?.name}`, severity: 'info' })
    }),
    openShift: (registerId, userId, openingFloat, notes) => {
      let s!: Shift
      mutate((db) => {
        const existing = db.shifts.find((x) => x.registerId === registerId && x.status === 'open')
        if (existing) { s = existing; return }
        s = { id: uid('sh'), registerId, userId, status: 'open', openedAt: nowISO(), openingFloat, cashMovements: [], notes, salesTotal: 0, salesCount: 0, refundsTotal: 0, refundsCount: 0, cashSales: 0, cardSales: 0, otherSales: 0 }
        db.shifts.push(s)
        const reg = db.registers.find((x) => x.id === registerId)
        pushLog(db, { userId, action: 'shift.opened', entity: 'shift', entityId: s.id, description: `Opened ${reg?.name ?? registerId} with float ${db.settings.currencySymbol}${openingFloat.toFixed(2)}`, severity: 'info', registerId })
        touchDisplay(db, registerId, 'idle')
      })
      return s
    },
    closeShift: (shiftId, closingCount, userId, notes) => {
      let s: Shift | undefined
      mutate((db) => {
        s = db.shifts.find((x) => x.id === shiftId)
        if (!s || s.status === 'closed') return
        const ins = s.cashMovements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0)
        const outs = s.cashMovements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0)
        s.expectedCash = round2(s.openingFloat + s.cashSales - Math.abs(s.refundsTotal) * 0 + ins - outs)
        // refunds paid in cash reduce expected cash: approximate via cash refunds recorded in transactions
        const cashRefunds = db.transactions.filter((t) => t.shiftId === s!.id && t.type === 'refund').reduce((a, t) => a + t.payments.filter((p) => p.method === 'cash').reduce((b, p) => b + p.amount, 0), 0)
        s.expectedCash = round2(s.expectedCash + cashRefunds)
        s.closingCount = closingCount
        s.difference = round2(closingCount - s.expectedCash)
        s.closedAt = nowISO()
        s.status = 'closed'
        if (notes) s.notes = notes
        const reg = db.registers.find((x) => x.id === s!.registerId)
        pushLog(db, { userId, action: 'shift.closed', entity: 'shift', entityId: s.id, description: `Closed ${reg?.name} · sales ${db.settings.currencySymbol}${s.salesTotal.toFixed(2)} · variance ${db.settings.currencySymbol}${s.difference.toFixed(2)}`, severity: Math.abs(s.difference) >= 5 ? 'warning' : 'info', registerId: s.registerId, meta: { expected: s.expectedCash, counted: closingCount } })
        if (Math.abs(s.difference) >= 5) pushAlert(db, { type: 'shift_variance', title: 'Cash drawer variance', message: `${reg?.name} closed with ${s.difference > 0 ? 'surplus' : 'shortage'} of ${db.settings.currencySymbol}${Math.abs(s.difference).toFixed(2)} (${findUserName(db, s.userId)})`, severity: 'warning', link: '/admin/shifts' })
        // clear active cart on close
        db.carts = db.carts.filter((c) => !(c.registerId === s!.registerId && !c.heldAt))
        touchDisplay(db, s.registerId, 'idle')
      })
      return s
    },
    cashMovement: (shiftId, type, amount, reason, userId) => mutate((db) => {
      const s = db.shifts.find((x) => x.id === shiftId)
      if (!s) return
      s.cashMovements.push({ id: uid('cm'), type, amount, reason, userId, createdAt: nowISO() })
      pushLog(db, { userId, action: `cash.${type}`, entity: 'shift', entityId: shiftId, description: `Cash ${type} ${db.settings.currencySymbol}${amount.toFixed(2)} – ${reason}`, severity: type === 'out' && amount >= 100 ? 'warning' : 'info', registerId: s.registerId })
    }),

    // ── Carts ────────────────────────────────────────────────────────────
    getActiveCart: (registerId, userId) => {
      const existing = get().db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (existing) return existing
      let cart!: Cart
      mutate((db) => { cart = ensureActiveCart(db, registerId, userId) })
      return cart
    },
    addToCart: (registerId, userId, productId, qty = 1, serial) => {
      let res: { ok: boolean; message?: string } = { ok: true }
      mutate((db) => {
        const p = db.products.find((x) => x.id === productId)
        if (!p) { res = { ok: false, message: 'Product not found' }; return }
        if (!p.active) { res = { ok: false, message: 'Product is inactive' }; return }
        const cart = ensureActiveCart(db, registerId, userId)
        const inCart = cart.lines.filter((l) => l.productId === productId && !l.isRefund).reduce((a, l) => a + l.qty, 0)
        if (p.categoryId !== 'cat_service' && p.stock - inCart < qty) { res = { ok: false, message: `Only ${Math.max(0, p.stock - inCart)} in stock for ${p.name}` }; return }
        if (p.trackSerial) {
          const used = cart.lines.filter((l) => l.productId === productId).map((l) => l.serial)
          const pickSerial = serial ?? p.serials.find((s) => !used.includes(s))
          for (let i = 0; i < qty; i++) {
            const s = i === 0 ? pickSerial : p.serials.find((x) => !used.includes(x) && x !== pickSerial)
            cart.lines.push({ id: uid('ln'), productId, name: p.name, sku: p.sku, emoji: p.emoji, unitPrice: p.price, originalPrice: p.price, qty: 1, taxable: p.taxable, serial: s })
            if (s) used.push(s)
          }
        } else {
          const line = cart.lines.find((l) => l.productId === productId && !l.isRefund && !l.discount && l.unitPrice === p.price)
          if (line) line.qty += qty
          else cart.lines.push({ id: uid('ln'), productId, name: p.name, sku: p.sku, emoji: p.emoji, unitPrice: p.price, originalPrice: p.price, qty, taxable: p.taxable })
        }
        cart.updatedAt = nowISO()
        autoPhase(db, registerId)
      })
      return res
    },
    updateLine: (registerId, lineId, patch) => mutate((db) => {
      const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      const line = cart?.lines.find((l) => l.id === lineId)
      if (!cart || !line) return
      Object.assign(line, patch)
      if (line.qty <= 0) cart.lines = cart.lines.filter((l) => l.id !== lineId)
      cart.updatedAt = nowISO()
      autoPhase(db, registerId)
    }),
    removeLine: (registerId, lineId) => mutate((db) => {
      const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (!cart) return
      cart.lines = cart.lines.filter((l) => l.id !== lineId)
      cart.updatedAt = nowISO()
      autoPhase(db, registerId)
    }),
    setCartDiscount: (registerId, discount) => mutate((db) => {
      const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (!cart) return
      cart.discount = discount && discount.value > 0 ? discount : undefined
      cart.updatedAt = nowISO()
    }),
    setCartCustomer: (registerId, customerId) => mutate((db) => {
      const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (!cart) return
      cart.customerId = customerId
      cart.updatedAt = nowISO()
    }),
    setCartPromo: (registerId, code) => {
      let res: { ok: boolean; message?: string } = { ok: true }
      mutate((db) => {
        const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
        if (!cart) return
        if (!code) { cart.promoCode = undefined; return }
        const promo = db.promotions.find((p) => p.code?.toLowerCase() === code.toLowerCase())
        if (!promo) { res = { ok: false, message: 'Unknown promo code' }; return }
        if (!promo.active) { res = { ok: false, message: 'Promotion is inactive' }; return }
        const now = Date.now()
        if (new Date(promo.startsAt).getTime() > now) { res = { ok: false, message: 'Promotion has not started yet' }; return }
        if (new Date(promo.endsAt).getTime() < now) { res = { ok: false, message: 'Promotion has expired' }; return }
        cart.promoCode = promo.code
        cart.updatedAt = nowISO()
      })
      return res
    },
    setCartNote: (registerId, note) => mutate((db) => {
      const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (cart) cart.note = note
    }),
    clearCart: (registerId, userId, reason) => mutate((db) => {
      const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (!cart) return
      if (cart.lines.length) pushLog(db, { userId, action: 'cart.cleared', entity: 'cart', entityId: cart.id, description: `Cleared cart with ${cart.lines.length} line(s)${reason ? ` – ${reason}` : ''}`, severity: 'info', registerId })
      db.carts = db.carts.filter((c) => c.id !== cart.id)
      touchDisplay(db, registerId, 'idle')
    }),
    holdCart: (registerId, userId, label) => mutate((db) => {
      const cart = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (!cart || !cart.lines.length) return
      cart.heldAt = nowISO()
      cart.label = label || `Hold ${db.carts.filter((c) => c.heldAt).length + 1}`
      pushLog(db, { userId, action: 'cart.held', entity: 'cart', entityId: cart.id, description: `Put sale on hold: ${cart.label} (${cart.lines.length} lines)`, severity: 'info', registerId })
      touchDisplay(db, registerId, 'idle')
    }),
    recallCart: (registerId, userId, cartId) => mutate((db) => {
      const held = db.carts.find((c) => c.id === cartId)
      if (!held) return
      const active = db.carts.find((c) => c.registerId === registerId && !c.heldAt)
      if (active && active.lines.length) { active.heldAt = nowISO(); active.label = active.label || `Hold ${db.carts.filter((c) => c.heldAt).length + 1}` }
      else if (active) db.carts = db.carts.filter((c) => c.id !== active.id)
      held.heldAt = undefined
      held.registerId = registerId
      held.userId = userId
      pushLog(db, { userId, action: 'cart.recalled', entity: 'cart', entityId: held.id, description: `Recalled held sale: ${held.label}`, severity: 'info', registerId })
      autoPhase(db, registerId)
    }),
    deleteHeldCart: (cartId, userId) => mutate((db) => {
      const c = db.carts.find((x) => x.id === cartId)
      if (!c) return
      db.carts = db.carts.filter((x) => x.id !== cartId)
      pushLog(db, { userId, action: 'cart.discarded', entity: 'cart', entityId: cartId, description: `Discarded held sale: ${c.label}`, severity: 'info', registerId: c.registerId })
    }),

    // ── Checkout ─────────────────────────────────────────────────────────
    checkout: (input) => {
      let res: { ok: boolean; transaction?: Transaction; message?: string } = { ok: false, message: 'Unknown error' }
      mutate((db) => {
        const cart = db.carts.find((c) => c.registerId === input.registerId && !c.heldAt)
        if (!cart || !cart.lines.length) { res = { ok: false, message: 'Cart is empty' }; return }
        const shift = db.shifts.find((s) => s.registerId === input.registerId && s.status === 'open')
        if (!shift) { res = { ok: false, message: 'No open shift on this register' }; return }
        const promo = cart.promoCode ? db.promotions.find((p) => p.code === cart.promoCode) : undefined
        const totals = calcCart(cart, db.settings, promo, db.products)
        const customer = cart.customerId ? db.customers.find((c) => c.id === cart.customerId) : undefined
        const redeem = Math.min(input.redeemPoints ?? 0, customer?.loyaltyPoints ?? 0)
        const redeemValue = round2(redeem * db.settings.loyaltyPointValue)
        const due = round2(totals.total - redeemValue)
        const paid = round2(input.payments.reduce((a, p) => a + p.amount, 0))
        if (paid + 0.005 < due) { res = { ok: false, message: `Payment short by ${db.settings.currencySymbol}${(due - paid).toFixed(2)}` }; return }
        // validate stock again
        for (const l of cart.lines) {
          const p = db.products.find((x) => x.id === l.productId)
          if (!p) { res = { ok: false, message: `Product missing: ${l.name}` }; return }
          if (p.categoryId !== 'cat_service' && !l.isRefund && p.stock < l.qty) { res = { ok: false, message: `Insufficient stock for ${p.name}` }; return }
        }
        // store credit check
        const credit = input.payments.filter((p) => p.method === 'store_credit').reduce((a, p) => a + p.amount, 0)
        if (credit > 0 && (!customer || customer.storeCredit + 0.005 < credit)) { res = { ok: false, message: 'Insufficient store credit' }; return }

        const tendered = input.payments.reduce((a, p) => a + (p.tendered ?? p.amount), 0)
        const change = round2(Math.max(0, tendered - due))
        const lines = toTransactionLines(cart, totals, db.products)
        const number = `${db.settings.numberPrefix}-${pad(db.settings.nextTransactionNumber++)}`
        const loyaltyEarned = customer ? Math.floor(due * db.settings.loyaltyPointsPerCurrency) : 0
        const tx: Transaction = {
          id: uid('tx'), number, type: 'sale', status: 'completed', registerId: input.registerId, shiftId: shift.id, userId: input.userId, customerId: cart.customerId,
          lines, subtotal: totals.subtotal, discountTotal: totals.discountTotal, cartDiscount: cart.discount, promoCode: cart.promoCode, taxTotal: totals.tax, total: due,
          payments: input.payments.map((p) => ({ ...p, id: uid('pay'), createdAt: nowISO() })), change, note: input.note ?? cart.note, createdAt: nowISO(),
          loyaltyEarned, loyaltyRedeemed: redeem, costTotal: round2(lines.reduce((a, l) => a + l.cost * l.qty, 0)),
        }
        db.transactions.push(tx)
        // stock & serials
        for (const l of cart.lines) {
          const p = db.products.find((x) => x.id === l.productId)!
          if (p.categoryId !== 'cat_service') moveStock(db, p.id, -l.qty, 'sale', input.userId, undefined, tx.id, l.serial)
          if (l.serial) p.serials = p.serials.filter((s) => s !== l.serial)
          p.soldCount += l.qty
        }
        // shift totals
        shift.salesTotal = round2(shift.salesTotal + due)
        shift.salesCount++
        tx.payments.forEach((p) => {
          if (p.method === 'cash') shift.cashSales = round2(shift.cashSales + p.amount - (p.tendered ? 0 : 0))
          else if (p.method === 'card') shift.cardSales = round2(shift.cardSales + p.amount)
          else shift.otherSales = round2(shift.otherSales + p.amount)
        })
        // cash: amount recorded is amount applied (tendered - change is handled since amount = due share)
        // customer
        if (customer) {
          customer.totalSpent = round2(customer.totalSpent + due)
          customer.visits++
          customer.lastVisitAt = nowISO()
          customer.loyaltyPoints = customer.loyaltyPoints - redeem + loyaltyEarned
          if (credit > 0) customer.storeCredit = round2(customer.storeCredit - credit)
        }
        if (promo) promo.usageCount++
        // log & alerts
        pushLog(db, { userId: input.userId, action: 'sale.completed', entity: 'transaction', entityId: tx.id, description: `Sale ${tx.number} · ${lines.length} item(s) · ${db.settings.currencySymbol}${due.toFixed(2)} (${tx.payments.map((p) => p.method).join(' + ')})`, severity: 'info', registerId: input.registerId, meta: { total: due } })
        if (tx.discountTotal > 0) {
          const pctOff = totals.subtotal > 0 ? (tx.discountTotal / totals.subtotal) * 100 : 0
          const big = pctOff >= db.settings.largeDiscountThreshold
          pushLog(db, { userId: input.userId, action: 'sale.discount', entity: 'transaction', entityId: tx.id, description: `Discount of ${db.settings.currencySymbol}${tx.discountTotal.toFixed(2)} (${pctOff.toFixed(0)}%) applied on ${tx.number}${input.approvedBy ? ` · approved by ${findUserName(db, input.approvedBy)}` : ''}`, severity: big ? 'warning' : 'info', registerId: input.registerId })
          if (big) pushAlert(db, { type: 'large_discount', title: 'Large discount applied', message: `${findUserName(db, input.userId)} applied ${pctOff.toFixed(0)}% off on ${tx.number} (${db.settings.currencySymbol}${tx.discountTotal.toFixed(2)})`, severity: 'warning', link: `/admin/transactions/${tx.id}` })
        }
        cart.lines.forEach((l) => {
          if (l.unitPrice !== l.originalPrice) {
            pushLog(db, { userId: input.userId, action: 'sale.price_override', entity: 'transaction', entityId: tx.id, description: `Price override on ${l.name}: ${l.originalPrice} → ${l.unitPrice} (${tx.number})`, severity: 'warning', registerId: input.registerId })
            pushAlert(db, { type: 'price_override', title: 'Price override', message: `${findUserName(db, input.userId)} changed ${l.name} from ${db.settings.currencySymbol}${l.originalPrice.toFixed(2)} to ${db.settings.currencySymbol}${l.unitPrice.toFixed(2)} on ${tx.number}`, severity: 'warning', link: `/admin/transactions/${tx.id}` })
          }
        })
        // remove cart, display
        db.carts = db.carts.filter((c) => c.id !== cart.id)
        touchDisplay(db, input.registerId, 'complete', { transactionId: tx.id })
        res = { ok: true, transaction: tx }
      })
      return res
    },
    refund: (input) => {
      let res: { ok: boolean; transaction?: Transaction; message?: string } = { ok: false, message: 'Unknown error' }
      mutate((db) => {
        const orig = db.transactions.find((t) => t.id === input.transactionId)
        if (!orig || orig.type !== 'sale') { res = { ok: false, message: 'Original sale not found' }; return }
        if (orig.status === 'voided' || orig.status === 'refunded') { res = { ok: false, message: 'Transaction already fully refunded or voided' }; return }
        const shift = db.shifts.find((s) => s.registerId === input.registerId && s.status === 'open')
        const lines = input.lines.filter((l) => l.qty > 0).map((l) => {
          const ol = orig.lines.find((x) => x.id === l.lineId)!
          const avail = ol.qty - ol.refundedQty
          const qty = Math.min(l.qty, avail)
          const per = ol.lineTotal / ol.qty
          const perTax = ol.taxAmount / ol.qty
          const perDisc = ol.discountAmount / ol.qty
          return { ol, qty, restock: l.restock, per, perTax, perDisc }
        }).filter((x) => x.qty > 0)
        if (!lines.length) { res = { ok: false, message: 'Nothing to refund' }; return }
        const total = -round2(lines.reduce((a, x) => a + x.per * x.qty, 0))
        const number = `${db.settings.numberPrefix}-${pad(db.settings.nextTransactionNumber++)}`
        const tx: Transaction = {
          id: uid('tx'), number, type: 'refund', status: 'completed', registerId: input.registerId, shiftId: shift?.id, userId: input.userId, customerId: orig.customerId,
          lines: lines.map((x) => ({ ...x.ol, id: uid('ln'), qty: -x.qty, lineTotal: -round2(x.per * x.qty), taxAmount: -round2(x.perTax * x.qty), discountAmount: -round2(x.perDisc * x.qty), refundedQty: 0 })),
          subtotal: -round2(lines.reduce((a, x) => a + x.ol.unitPrice * x.qty, 0)), discountTotal: -round2(lines.reduce((a, x) => a + x.perDisc * x.qty, 0)), taxTotal: -round2(lines.reduce((a, x) => a + x.perTax * x.qty, 0)),
          total, payments: [{ id: uid('pay'), method: input.method, amount: total, createdAt: nowISO() }], change: 0, note: input.reason, createdAt: nowISO(), refundOf: orig.id,
          loyaltyEarned: 0, loyaltyRedeemed: 0, costTotal: -round2(lines.reduce((a, x) => a + x.ol.cost * x.qty, 0)),
        }
        db.transactions.push(tx)
        lines.forEach((x) => {
          x.ol.refundedQty += x.qty
          const p = db.products.find((pp) => pp.id === x.ol.productId)
          if (p) {
            p.soldCount -= x.qty
            if (x.restock && p.categoryId !== 'cat_service') {
              moveStock(db, p.id, x.qty, 'refund', input.userId, input.reason, tx.id, x.ol.serial)
              if (x.ol.serial && p.trackSerial) p.serials.push(x.ol.serial)
            } else if (!x.restock && p.categoryId !== 'cat_service') {
              db.stockMovements.push({ id: uid('sm'), productId: p.id, type: 'damage', qty: 0, before: p.stock, after: p.stock, reason: `Refund without restock – ${input.reason}`, refId: tx.id, userId: input.userId, createdAt: nowISO(), serial: x.ol.serial })
            }
          }
        })
        const allRefunded = orig.lines.every((l) => l.refundedQty >= l.qty)
        orig.status = allRefunded ? 'refunded' : 'partially_refunded'
        if (shift) { shift.refundsTotal = round2(shift.refundsTotal + total); shift.refundsCount++ }
        const customer = orig.customerId ? db.customers.find((c) => c.id === orig.customerId) : undefined
        if (customer) {
          customer.totalSpent = round2(customer.totalSpent + total)
          if (input.method === 'store_credit') customer.storeCredit = round2(customer.storeCredit + Math.abs(total))
        }
        const big = Math.abs(total) >= db.settings.largeRefundThreshold
        pushLog(db, { userId: input.userId, action: 'refund.completed', entity: 'transaction', entityId: tx.id, description: `Refund ${tx.number} for ${orig.number} · ${db.settings.currencySymbol}${Math.abs(total).toFixed(2)} via ${input.method} – ${input.reason}${input.approvedBy ? ` · approved by ${findUserName(db, input.approvedBy)}` : ''}`, severity: big ? 'warning' : 'info', registerId: input.registerId, meta: { approvedBy: input.approvedBy } })
        if (big) pushAlert(db, { type: 'large_refund', title: 'Large refund processed', message: `${findUserName(db, input.userId)} refunded ${db.settings.currencySymbol}${Math.abs(total).toFixed(2)} on ${orig.number}`, severity: 'warning', link: `/admin/transactions/${tx.id}` })
        res = { ok: true, transaction: tx }
      })
      return res
    },
    voidTransaction: (transactionId, userId, reason, approvedBy) => {
      let res: { ok: boolean; message?: string } = { ok: false, message: 'Unknown error' }
      mutate((db) => {
        const tx = db.transactions.find((t) => t.id === transactionId)
        if (!tx) { res = { ok: false, message: 'Transaction not found' }; return }
        if (tx.status !== 'completed' || tx.type !== 'sale') { res = { ok: false, message: 'Only completed sales can be voided' }; return }
        if (tx.lines.some((l) => l.refundedQty > 0)) { res = { ok: false, message: 'Transaction has refunds; void not allowed' }; return }
        tx.status = 'voided'
        tx.voidedAt = nowISO()
        tx.voidReason = reason
        tx.lines.forEach((l) => {
          const p = db.products.find((x) => x.id === l.productId)
          if (!p) return
          p.soldCount -= l.qty
          if (p.categoryId !== 'cat_service') moveStock(db, p.id, l.qty, 'refund', userId, `Void ${tx.number}`, tx.id, l.serial)
          if (l.serial && p.trackSerial) p.serials.push(l.serial)
        })
        const shift = tx.shiftId ? db.shifts.find((s) => s.id === tx.shiftId) : undefined
        if (shift && shift.status === 'open') {
          shift.salesTotal = round2(shift.salesTotal - tx.total)
          shift.salesCount--
          tx.payments.forEach((p) => {
            if (p.method === 'cash') shift.cashSales = round2(shift.cashSales - p.amount)
            else if (p.method === 'card') shift.cardSales = round2(shift.cardSales - p.amount)
            else shift.otherSales = round2(shift.otherSales - p.amount)
          })
        }
        const customer = tx.customerId ? db.customers.find((c) => c.id === tx.customerId) : undefined
        if (customer) { customer.totalSpent = round2(customer.totalSpent - tx.total); customer.loyaltyPoints = Math.max(0, customer.loyaltyPoints - tx.loyaltyEarned + tx.loyaltyRedeemed) }
        pushLog(db, { userId, action: 'sale.voided', entity: 'transaction', entityId: tx.id, description: `Voided ${tx.number} (${db.settings.currencySymbol}${tx.total.toFixed(2)}) – ${reason}${approvedBy ? ` · approved by ${findUserName(db, approvedBy)}` : ''}`, severity: 'critical', registerId: tx.registerId })
        pushAlert(db, { type: 'void', title: 'Transaction voided', message: `${findUserName(db, userId)} voided ${tx.number} for ${db.settings.currencySymbol}${tx.total.toFixed(2)} – ${reason}`, severity: 'critical', link: `/admin/transactions/${tx.id}` })
        res = { ok: true }
      })
      return res
    },

    // ── Display ──────────────────────────────────────────────────────────
    setDisplay: (registerId, phase, extra) => mutate((db) => touchDisplay(db, registerId, phase, extra)),

    // ── Promotions ───────────────────────────────────────────────────────
    upsertPromotion: (p, userId) => mutate((db) => {
      const ex = p.id ? db.promotions.find((x) => x.id === p.id) : undefined
      if (ex) Object.assign(ex, p)
      else db.promotions.push({ id: uid('promo'), name: p.name || 'New promotion', code: p.code, type: p.type || 'percent', value: p.value ?? 0, scope: p.scope || 'all', targetIds: p.targetIds ?? [], minQty: p.minQty, startsAt: p.startsAt || nowISO(), endsAt: p.endsAt || nowISO(), active: p.active ?? true, usageCount: 0, description: p.description })
      pushLog(db, { userId, action: ex ? 'promotion.updated' : 'promotion.created', entity: 'promotion', entityId: p.id, description: `${ex ? 'Updated' : 'Created'} promotion ${p.name ?? ex?.name}`, severity: 'info' })
    }),
    deletePromotion: (id, userId) => mutate((db) => {
      const p = db.promotions.find((x) => x.id === id)
      db.promotions = db.promotions.filter((x) => x.id !== id)
      if (p) pushLog(db, { userId, action: 'promotion.deleted', entity: 'promotion', entityId: id, description: `Deleted promotion ${p.name}`, severity: 'warning' })
    }),

    // ── Purchase orders ──────────────────────────────────────────────────
    upsertPurchaseOrder: (po, userId) => {
      let result!: PurchaseOrder
      mutate((db) => {
        const ex = po.id ? db.purchaseOrders.find((x) => x.id === po.id) : undefined
        if (ex) { Object.assign(ex, po); result = ex }
        else {
          const n: PurchaseOrder = { id: uid('po'), number: `PO-${pad(db.settings.nextPONumber++, 4)}`, supplierId: po.supplierId || db.suppliers[0]!.id, lines: po.lines ?? [], status: po.status || 'draft', createdAt: nowISO(), expectedAt: po.expectedAt, userId, notes: po.notes }
          db.purchaseOrders.push(n)
          result = n
        }
        pushLog(db, { userId, action: ex ? 'po.updated' : 'po.created', entity: 'purchase_order', entityId: result.id, description: `${ex ? 'Updated' : 'Created'} purchase order ${result.number}`, severity: 'info' })
      })
      return result
    },
    setPOStatus: (id, status, userId) => mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id)
      if (!po) return
      po.status = status
      pushLog(db, { userId, action: 'po.status', entity: 'purchase_order', entityId: id, description: `${po.number} marked as ${status}`, severity: status === 'cancelled' ? 'warning' : 'info' })
    }),
    receivePO: (id, received, userId) => mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id)
      if (!po) return
      po.lines.forEach((l) => {
        const q = Math.max(0, Math.min(received[l.id] ?? 0, l.qty - l.received))
        if (q > 0) {
          l.received += q
          moveStock(db, l.productId, q, 'purchase', userId, `Received on ${po.number}`, po.id)
          const p = db.products.find((x) => x.id === l.productId)
          if (p) { p.cost = l.cost; if (p.trackSerial) for (let i = 0; i < q; i++) p.serials.push(`35${String(Date.now() + i).slice(-13)}`) }
        }
      })
      const full = po.lines.every((l) => l.received >= l.qty)
      po.status = full ? 'received' : 'partial'
      if (full) po.receivedAt = nowISO()
      const sup = db.suppliers.find((s) => s.id === po.supplierId)
      pushLog(db, { userId, action: full ? 'po.received' : 'po.partial', entity: 'purchase_order', entityId: id, description: `${full ? 'Fully' : 'Partially'} received ${po.number} from ${sup?.name}`, severity: 'info' })
      if (full) pushAlert(db, { type: 'po_received', title: 'Purchase order received', message: `${po.number} from ${sup?.name} has been fully received into stock.`, severity: 'info', link: '/admin/purchase-orders' })
    }),
    deletePurchaseOrder: (id, userId) => mutate((db) => {
      const po = db.purchaseOrders.find((x) => x.id === id)
      db.purchaseOrders = db.purchaseOrders.filter((x) => x.id !== id)
      if (po) pushLog(db, { userId, action: 'po.deleted', entity: 'purchase_order', entityId: id, description: `Deleted ${po.number}`, severity: 'warning' })
    }),

    // ── Repairs ──────────────────────────────────────────────────────────
    upsertRepair: (t, userId) => {
      let result!: RepairTicket
      mutate((db) => {
        const ex = t.id ? db.repairs.find((x) => x.id === t.id) : undefined
        if (ex) { Object.assign(ex, t, { updatedAt: nowISO() }); result = ex }
        else {
          const n: RepairTicket = { id: uid('rep'), number: `RP-${pad(db.settings.nextRepairNumber++, 4)}`, customerId: t.customerId || '', device: t.device || '', imei: t.imei, issue: t.issue || '', status: t.status || 'received', estimate: t.estimate ?? 0, deposit: t.deposit ?? 0, technicianId: t.technicianId, createdAt: nowISO(), updatedAt: nowISO(), promisedAt: t.promisedAt, notes: [], paid: false }
          db.repairs.push(n)
          result = n
        }
        pushLog(db, { userId, action: ex ? 'repair.updated' : 'repair.created', entity: 'repair', entityId: result.id, description: `${ex ? 'Updated' : 'Opened'} repair ticket ${result.number} – ${result.device}: ${result.issue}`, severity: 'info' })
      })
      return result
    },
    setRepairStatus: (id, status, userId, note) => mutate((db) => {
      const t = db.repairs.find((x) => x.id === id)
      if (!t) return
      t.status = status
      t.updatedAt = nowISO()
      if (status === 'collected') t.paid = true
      if (note) t.notes.push({ id: uid('rn'), userId, text: note, createdAt: nowISO() })
      pushLog(db, { userId, action: 'repair.status', entity: 'repair', entityId: id, description: `${t.number} → ${status.replace(/_/g, ' ')}`, severity: 'info' })
      if (status === 'ready') {
        const c = db.customers.find((x) => x.id === t.customerId)
        pushAlert(db, { type: 'repair_ready', title: 'Repair ready for pickup', message: `${t.number} · ${t.device} is ready. Notify ${c?.name ?? 'customer'}.`, severity: 'info', link: '/admin/repairs' })
      }
    }),
    addRepairNote: (id, text, userId) => mutate((db) => {
      const t = db.repairs.find((x) => x.id === id)
      if (!t) return
      t.notes.push({ id: uid('rn'), userId, text, createdAt: nowISO() })
      t.updatedAt = nowISO()
    }),
    deleteRepair: (id, userId) => mutate((db) => {
      const t = db.repairs.find((x) => x.id === id)
      db.repairs = db.repairs.filter((x) => x.id !== id)
      if (t) pushLog(db, { userId, action: 'repair.deleted', entity: 'repair', entityId: id, description: `Deleted repair ticket ${t.number}`, severity: 'warning' })
    }),

    // ── Alerts ───────────────────────────────────────────────────────────
    markAlertRead: (id, read = true) => mutate((db) => { const a = db.alerts.find((x) => x.id === id); if (a) a.read = read }),
    markAllAlertsRead: () => mutate((db) => db.alerts.forEach((a) => (a.read = true))),
    dismissAlert: (id) => mutate((db) => { db.alerts = db.alerts.filter((a) => a.id !== id) }),

    // ── Settings & data ──────────────────────────────────────────────────
    updateSettings: (patch, userId) => {
      mutate((db) => {
        Object.assign(db.settings, patch)
        pushLog(db, { userId, action: 'settings.updated', entity: 'settings', description: `Updated settings: ${Object.keys(patch).join(', ')}`, severity: 'warning' })
      })
      const s = get().db.settings
      configureCurrency(s.locale, s.currency)
    },
    resetDemo: () => {
      const db = buildSeed()
      configureCurrency(db.settings.locale, db.settings.currency)
      set({ db })
      persist(db)
    },
    importDatabase: (db) => {
      if (!db || typeof db !== 'object' || !Array.isArray(db.products) || !db.settings) return false
      const next = { ...db, version: DB_VERSION }
      configureCurrency(next.settings.locale, next.settings.currency)
      set({ db: next })
      persist(next)
      return true
    },
    exportDatabase: () => JSON.stringify(get().db, null, 2),
  }
})

// ─── Cross-tab sync ──────────────────────────────────────────────────────────
if (channel) {
  channel.onmessage = (ev) => {
    if (ev.data?.type === 'db' && ev.data.from !== TAB_ID) useDB.getState().hydrate()
  }
}
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY && !channel) useDB.getState().hydrate()
})

// ─── Selectors / hooks ───────────────────────────────────────────────────────
export const useSettings = () => useDB((s) => s.db.settings)
export const useProducts = () => useDB((s) => s.db.products)
export const useCustomers = () => useDB((s) => s.db.customers)
export const useUsers = () => useDB((s) => s.db.users)
export const useRegisters = () => useDB((s) => s.db.registers)
export const useTransactions = () => useDB((s) => s.db.transactions)
export const useCategories = () => useDB((s) => s.db.categories)
export const useBrands = () => useDB((s) => s.db.brands)
export const useActiveCart = (registerId: ID | undefined) => useDB((s) => (registerId ? s.db.carts.find((c) => c.registerId === registerId && !c.heldAt) : undefined))
export const useOpenShift = (registerId: ID | undefined) => useDB((s) => (registerId ? s.db.shifts.find((x) => x.registerId === registerId && x.status === 'open') : undefined))
