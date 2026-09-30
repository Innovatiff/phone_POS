import type {
  Database, User, Category, Brand, Supplier, Product, Customer, Register, Shift, Transaction, StockMovement,
  ActivityLog, Promotion, PurchaseOrder, RepairTicket, Alert, Settings, TransactionLine, Payment, PaymentMethod,
} from '@/lib/types'
import { calcCart } from '@/lib/pos'
import { generateBarcode, generateIMEI, pad, rng, round2, uid } from '@/lib/utils'

export const DB_VERSION = 3

const ALL_PERMS = ['sell','refund','discount','price_override','void','cash_drawer','reports','catalog','inventory','customers','staff','settings'] as const

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'Phone man',
  tagline: 'Phones · Accessories · Repairs',
  address: '128 Market Street, Downtown',
  phone: '+1 (555) 010-7788',
  email: 'hello@phoneman.store',
  website: 'phoneman.store',
  currency: 'USD',
  currencySymbol: '$',
  locale: 'en-US',
  taxRate: 8.5,
  taxName: 'Sales Tax',
  taxInclusive: false,
  receiptHeader: 'Thank you for shopping at Phone man!',
  receiptFooter: 'Returns accepted within 14 days with receipt. Phones must be in original condition.',
  loyaltyPointsPerCurrency: 1,
  loyaltyPointValue: 0.01,
  lowStockDefault: 5,
  cashierMaxDiscountPercent: 15,
  requireManagerForRefund: true,
  requireManagerForVoid: true,
  largeRefundThreshold: 300,
  largeDiscountThreshold: 20,
  displayIdleMessages: [
    'Welcome to Phone man 👋',
    'Ask about our 12-month warranty on all phones',
    'Trade in your old phone and save up to $250',
    'Screen repairs while you wait — from $49',
  ],
  displayShowPromotions: true,
  displayAccent: '#2563eb',
  autoPrintReceipt: false,
  openingFloatDefault: 200,
  numberPrefix: 'PM',
  nextTransactionNumber: 1,
  nextPONumber: 1,
  nextRepairNumber: 1,
}

const iso = (d: Date) => d.toISOString()
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

export function buildSeed(): Database {
  const r = rng(20240917)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)]!
  const rint = (min: number, max: number) => Math.floor(r() * (max - min + 1)) + min
  const now = new Date()
  const start = addDays(now, -120)
  start.setHours(0, 0, 0, 0)
  const sinceStart = (days: number, hour = 9, min = 0) => { const d = addDays(start, days); d.setHours(hour, min, 0, 0); return d }

  // ── Users ─────────────────────────────────────────────────────────────────
  const users: User[] = [
    { id: 'u_admin', name: 'Alex Morgan', role: 'admin', email: 'admin@phoneman.store', pin: '0000', password: 'admin123', color: '#2563eb', active: true, permissions: [...ALL_PERMS], createdAt: iso(start), phone: '+1 555 010 0001' },
    { id: 'u_mgr', name: 'Priya Natarajan', role: 'manager', email: 'priya@phoneman.store', pin: '9999', password: 'manager123', color: '#7c3aed', active: true, permissions: ['sell','refund','discount','price_override','void','cash_drawer','reports','catalog','inventory','customers'], createdAt: iso(start), phone: '+1 555 010 0002' },
    { id: 'u_c1', name: 'Jordan Lee', role: 'cashier', email: 'jordan@phoneman.store', pin: '1111', color: '#059669', active: true, permissions: ['sell','discount','customers'], createdAt: iso(start) },
    { id: 'u_c2', name: 'Sam Rivera', role: 'cashier', email: 'sam@phoneman.store', pin: '2222', color: '#ea580c', active: true, permissions: ['sell','discount','customers','cash_drawer'], createdAt: iso(start) },
    { id: 'u_c3', name: 'Taylor Brooks', role: 'cashier', email: 'taylor@phoneman.store', pin: '3333', color: '#db2777', active: true, permissions: ['sell','customers'], createdAt: iso(addDays(start, 20)) },
    { id: 'u_c4', name: 'Casey Nguyen', role: 'cashier', email: 'casey@phoneman.store', pin: '4444', color: '#0891b2', active: false, permissions: ['sell','customers'], createdAt: iso(addDays(start, 40)) },
  ]

  // ── Categories / Brands / Suppliers ──────────────────────────────────────
  const categories: Category[] = [
    { id: 'cat_phones', name: 'Smartphones', color: '#2563eb', icon: '📱', sortOrder: 1 },
    { id: 'cat_tablets', name: 'Tablets', color: '#7c3aed', icon: '📟', sortOrder: 2 },
    { id: 'cat_wear', name: 'Wearables', color: '#db2777', icon: '⌚', sortOrder: 3 },
    { id: 'cat_audio', name: 'Audio', color: '#059669', icon: '🎧', sortOrder: 4 },
    { id: 'cat_cases', name: 'Cases & Protection', color: '#ea580c', icon: '🛡️', sortOrder: 5 },
    { id: 'cat_charge', name: 'Chargers & Cables', color: '#ca8a04', icon: '🔌', sortOrder: 6 },
    { id: 'cat_acc', name: 'Accessories', color: '#0891b2', icon: '🎒', sortOrder: 7 },
    { id: 'cat_service', name: 'Services & Repairs', color: '#64748b', icon: '🔧', sortOrder: 8 },
    { id: 'cat_sim', name: 'SIM & Plans', color: '#4f46e5', icon: '📶', sortOrder: 9 },
  ]
  const brands: Brand[] = [
    { id: 'b_apple', name: 'Apple' }, { id: 'b_samsung', name: 'Samsung' }, { id: 'b_google', name: 'Google' },
    { id: 'b_xiaomi', name: 'Xiaomi' }, { id: 'b_oneplus', name: 'OnePlus' }, { id: 'b_motorola', name: 'Motorola' },
    { id: 'b_anker', name: 'Anker' }, { id: 'b_spigen', name: 'Spigen' }, { id: 'b_belkin', name: 'Belkin' },
    { id: 'b_sony', name: 'Sony' }, { id: 'b_jbl', name: 'JBL' }, { id: 'b_phoneman', name: 'Phone man' },
    { id: 'b_otterbox', name: 'OtterBox' }, { id: 'b_generic', name: 'Generic' },
  ]
  const suppliers: Supplier[] = [
    { id: 'sup_1', name: 'Ingram Mobile Distribution', contactName: 'Dana Whitfield', phone: '+1 555 200 1000', email: 'orders@ingrammobile.com', address: '400 Logistics Way', createdAt: iso(start) },
    { id: 'sup_2', name: 'TechSource Wholesale', contactName: 'Marco Bellini', phone: '+1 555 200 2000', email: 'sales@techsource.com', createdAt: iso(start) },
    { id: 'sup_3', name: 'AccessoryHub', contactName: 'Lin Zhao', phone: '+1 555 200 3000', email: 'hi@accessoryhub.io', createdAt: iso(start) },
    { id: 'sup_4', name: 'Parts Depot (Repairs)', contactName: 'Omar Haddad', phone: '+1 555 200 4000', email: 'parts@partsdepot.com', createdAt: iso(start) },
  ]

  // ── Products ─────────────────────────────────────────────────────────────
  type PSeed = [string, string, string, number, number, string, Partial<Product>]
  // [name, brandId, categoryId, price, cost, emoji, extra]
  const seeds: PSeed[] = [
    ['iPhone 15 Pro 128GB', 'b_apple', 'cat_phones', 999, 820, '📱', { attrs: { storage: '128GB', color: 'Natural Titanium' }, trackSerial: true, supplierId: 'sup_1', tags: ['flagship','5g'] }],
    ['iPhone 15 Pro 256GB', 'b_apple', 'cat_phones', 1099, 905, '📱', { attrs: { storage: '256GB', color: 'Blue Titanium' }, trackSerial: true, supplierId: 'sup_1', tags: ['flagship','5g'] }],
    ['iPhone 15 128GB', 'b_apple', 'cat_phones', 799, 650, '📱', { attrs: { storage: '128GB', color: 'Black' }, trackSerial: true, supplierId: 'sup_1', tags: ['5g'] }],
    ['iPhone 14 128GB', 'b_apple', 'cat_phones', 699, 560, '📱', { attrs: { storage: '128GB', color: 'Midnight' }, trackSerial: true, supplierId: 'sup_1' }],
    ['iPhone 13 128GB (Refurbished)', 'b_apple', 'cat_phones', 449, 330, '📱', { attrs: { storage: '128GB', color: 'Blue', condition: 'refurbished' }, trackSerial: true, supplierId: 'sup_2', tags: ['refurbished','value'] }],
    ['iPhone SE (3rd gen) 64GB', 'b_apple', 'cat_phones', 429, 350, '📱', { attrs: { storage: '64GB', color: 'Starlight' }, trackSerial: true, supplierId: 'sup_1', tags: ['value'] }],
    ['Galaxy S24 Ultra 256GB', 'b_samsung', 'cat_phones', 1299, 1060, '📱', { attrs: { storage: '256GB', color: 'Titanium Gray' }, trackSerial: true, supplierId: 'sup_1', tags: ['flagship','5g'] }],
    ['Galaxy S24 128GB', 'b_samsung', 'cat_phones', 799, 640, '📱', { attrs: { storage: '128GB', color: 'Onyx Black' }, trackSerial: true, supplierId: 'sup_1', tags: ['5g'] }],
    ['Galaxy A55 128GB', 'b_samsung', 'cat_phones', 449, 350, '📱', { attrs: { storage: '128GB', color: 'Awesome Navy' }, trackSerial: true, supplierId: 'sup_1', tags: ['value','5g'] }],
    ['Galaxy A15 128GB', 'b_samsung', 'cat_phones', 199, 150, '📱', { attrs: { storage: '128GB', color: 'Blue Black' }, trackSerial: true, supplierId: 'sup_2', tags: ['budget'] }],
    ['Galaxy Z Flip6 256GB', 'b_samsung', 'cat_phones', 1099, 900, '📱', { attrs: { storage: '256GB', color: 'Mint' }, trackSerial: true, supplierId: 'sup_1', tags: ['foldable'] }],
    ['Pixel 9 Pro 128GB', 'b_google', 'cat_phones', 999, 810, '📱', { attrs: { storage: '128GB', color: 'Obsidian' }, trackSerial: true, supplierId: 'sup_1', tags: ['flagship','5g'] }],
    ['Pixel 9 128GB', 'b_google', 'cat_phones', 799, 640, '📱', { attrs: { storage: '128GB', color: 'Peony' }, trackSerial: true, supplierId: 'sup_1' }],
    ['Pixel 8a 128GB', 'b_google', 'cat_phones', 499, 390, '📱', { attrs: { storage: '128GB', color: 'Bay' }, trackSerial: true, supplierId: 'sup_1', tags: ['value'] }],
    ['Xiaomi 14 256GB', 'b_xiaomi', 'cat_phones', 749, 590, '📱', { attrs: { storage: '256GB', color: 'Jade Green' }, trackSerial: true, supplierId: 'sup_2' }],
    ['Redmi Note 13 Pro 256GB', 'b_xiaomi', 'cat_phones', 329, 250, '📱', { attrs: { storage: '256GB', color: 'Midnight Black' }, trackSerial: true, supplierId: 'sup_2', tags: ['value'] }],
    ['OnePlus 12 256GB', 'b_oneplus', 'cat_phones', 799, 640, '📱', { attrs: { storage: '256GB', color: 'Flowy Emerald' }, trackSerial: true, supplierId: 'sup_2' }],
    ['Moto G Power 5G 128GB', 'b_motorola', 'cat_phones', 299, 220, '📱', { attrs: { storage: '128GB', color: 'Midnight Blue' }, trackSerial: true, supplierId: 'sup_2', tags: ['budget'] }],
    ['iPad 10th gen 64GB', 'b_apple', 'cat_tablets', 349, 280, '📟', { attrs: { storage: '64GB', color: 'Silver' }, trackSerial: true, supplierId: 'sup_1' }],
    ['iPad Air M2 128GB', 'b_apple', 'cat_tablets', 599, 490, '📟', { attrs: { storage: '128GB', color: 'Space Gray' }, trackSerial: true, supplierId: 'sup_1' }],
    ['Galaxy Tab S9 FE 128GB', 'b_samsung', 'cat_tablets', 449, 350, '📟', { attrs: { storage: '128GB', color: 'Gray' }, trackSerial: true, supplierId: 'sup_1' }],
    ['Apple Watch Series 9 41mm', 'b_apple', 'cat_wear', 399, 320, '⌚', { attrs: { size: '41mm', color: 'Midnight' }, trackSerial: true, supplierId: 'sup_1' }],
    ['Apple Watch SE 40mm', 'b_apple', 'cat_wear', 249, 195, '⌚', { attrs: { size: '40mm', color: 'Starlight' }, trackSerial: true, supplierId: 'sup_1' }],
    ['Galaxy Watch6 40mm', 'b_samsung', 'cat_wear', 299, 230, '⌚', { attrs: { size: '40mm', color: 'Graphite' }, trackSerial: true, supplierId: 'sup_1' }],
    ['Pixel Watch 2', 'b_google', 'cat_wear', 349, 270, '⌚', { attrs: { color: 'Matte Black' }, trackSerial: true, supplierId: 'sup_1' }],
    ['AirPods Pro (2nd gen)', 'b_apple', 'cat_audio', 249, 190, '🎧', { supplierId: 'sup_1', tags: ['bestseller'] }],
    ['AirPods (3rd gen)', 'b_apple', 'cat_audio', 169, 125, '🎧', { supplierId: 'sup_1' }],
    ['Galaxy Buds2 Pro', 'b_samsung', 'cat_audio', 189, 140, '🎧', { supplierId: 'sup_1' }],
    ['Sony WH-1000XM5', 'b_sony', 'cat_audio', 349, 270, '🎧', { supplierId: 'sup_3' }],
    ['Sony WF-1000XM5', 'b_sony', 'cat_audio', 279, 210, '🎧', { supplierId: 'sup_3' }],
    ['JBL Flip 6 Speaker', 'b_jbl', 'cat_audio', 129, 85, '🔊', { supplierId: 'sup_3' }],
    ['JBL Tune 510BT', 'b_jbl', 'cat_audio', 49, 28, '🎧', { supplierId: 'sup_3' }],
    ['Wireless Earbuds Pro', 'b_phoneman', 'cat_audio', 39, 12, '🎧', { supplierId: 'sup_3', tags: ['house-brand'] }],
    ['Spigen Tough Armor – iPhone 15 Pro', 'b_spigen', 'cat_cases', 34.99, 14, '🛡️', { attrs: { color: 'Black' }, supplierId: 'sup_3', tags: ['bestseller'] }],
    ['Spigen Ultra Hybrid – iPhone 15', 'b_spigen', 'cat_cases', 24.99, 10, '🛡️', { attrs: { color: 'Crystal Clear' }, supplierId: 'sup_3' }],
    ['OtterBox Defender – Galaxy S24 Ultra', 'b_otterbox', 'cat_cases', 59.99, 28, '🛡️', { attrs: { color: 'Black' }, supplierId: 'sup_3' }],
    ['OtterBox Symmetry – Pixel 9', 'b_otterbox', 'cat_cases', 49.99, 22, '🛡️', { attrs: { color: 'Blue' }, supplierId: 'sup_3' }],
    ['Silicone Case – iPhone 15 Pro', 'b_apple', 'cat_cases', 49, 24, '🛡️', { attrs: { color: 'Storm Blue' }, supplierId: 'sup_1' }],
    ['Clear Case – Galaxy A55', 'b_generic', 'cat_cases', 12.99, 3, '🛡️', { supplierId: 'sup_3' }],
    ['Tempered Glass Screen Protector – iPhone 15/15 Pro', 'b_phoneman', 'cat_cases', 14.99, 2.5, '🪟', { supplierId: 'sup_3', tags: ['bestseller','house-brand'] }],
    ['Tempered Glass Screen Protector – Galaxy S24', 'b_phoneman', 'cat_cases', 14.99, 2.5, '🪟', { supplierId: 'sup_3', tags: ['house-brand'] }],
    ['Tempered Glass Screen Protector – Pixel 9', 'b_phoneman', 'cat_cases', 14.99, 2.5, '🪟', { supplierId: 'sup_3', tags: ['house-brand'] }],
    ['Privacy Screen Protector – iPhone 15 Pro', 'b_belkin', 'cat_cases', 29.99, 11, '🪟', { supplierId: 'sup_3' }],
    ['Anker 20W USB-C Charger', 'b_anker', 'cat_charge', 19.99, 8, '🔌', { supplierId: 'sup_3', tags: ['bestseller'] }],
    ['Anker 65W GaN Charger', 'b_anker', 'cat_charge', 44.99, 22, '🔌', { supplierId: 'sup_3' }],
    ['Anker PowerCore 10000 Power Bank', 'b_anker', 'cat_charge', 29.99, 14, '🔋', { supplierId: 'sup_3' }],
    ['Anker 3-in-1 MagSafe Stand', 'b_anker', 'cat_charge', 89.99, 45, '🔋', { supplierId: 'sup_3' }],
    ['USB-C to USB-C Cable 1m', 'b_phoneman', 'cat_charge', 9.99, 1.8, '🔌', { supplierId: 'sup_3', tags: ['house-brand'] }],
    ['USB-C to Lightning Cable 1m', 'b_belkin', 'cat_charge', 19.99, 7, '🔌', { supplierId: 'sup_3' }],
    ['Apple 20W USB-C Power Adapter', 'b_apple', 'cat_charge', 19, 12, '🔌', { supplierId: 'sup_1' }],
    ['Samsung 25W Super Fast Charger', 'b_samsung', 'cat_charge', 24.99, 12, '🔌', { supplierId: 'sup_1' }],
    ['Wireless Charging Pad 15W', 'b_belkin', 'cat_charge', 34.99, 15, '🔋', { supplierId: 'sup_3' }],
    ['Car Charger Dual USB-C 40W', 'b_anker', 'cat_charge', 24.99, 10, '🚗', { supplierId: 'sup_3' }],
    ['Car Phone Mount (Vent)', 'b_generic', 'cat_acc', 15.99, 4, '🚗', { supplierId: 'sup_3' }],
    ['Phone Stand Holder', 'b_phoneman', 'cat_acc', 12.99, 3, '📐', { supplierId: 'sup_3', tags: ['house-brand'] }],
    ['PopSocket Grip', 'b_generic', 'cat_acc', 9.99, 2.5, '⭕', { supplierId: 'sup_3' }],
    ['MicroSD Card 128GB', 'b_samsung', 'cat_acc', 19.99, 9, '💾', { supplierId: 'sup_2' }],
    ['MicroSD Card 256GB', 'b_samsung', 'cat_acc', 32.99, 16, '💾', { supplierId: 'sup_2' }],
    ['AirTag (1 pack)', 'b_apple', 'cat_acc', 29, 21, '🏷️', { supplierId: 'sup_1' }],
    ['Bluetooth Selfie Stick Tripod', 'b_generic', 'cat_acc', 22.99, 7, '🤳', { supplierId: 'sup_3' }],
    ['Laptop Sleeve 13"', 'b_generic', 'cat_acc', 24.99, 8, '💼', { supplierId: 'sup_3' }],
    ['Screen Replacement – iPhone (Standard)', 'b_phoneman', 'cat_service', 129, 55, '🔧', { taxable: false, trackSerial: false, supplierId: 'sup_4', tags: ['service'] }],
    ['Screen Replacement – Samsung (Standard)', 'b_phoneman', 'cat_service', 149, 65, '🔧', { taxable: false, supplierId: 'sup_4', tags: ['service'] }],
    ['Battery Replacement', 'b_phoneman', 'cat_service', 69, 22, '🔋', { taxable: false, supplierId: 'sup_4', tags: ['service'] }],
    ['Charging Port Repair', 'b_phoneman', 'cat_service', 59, 15, '🔧', { taxable: false, supplierId: 'sup_4', tags: ['service'] }],
    ['Water Damage Diagnostic', 'b_phoneman', 'cat_service', 39, 0, '💧', { taxable: false, tags: ['service'] }],
    ['Data Transfer Service', 'b_phoneman', 'cat_service', 29, 0, '🔁', { taxable: false, tags: ['service'] }],
    ['Screen Protector Installation', 'b_phoneman', 'cat_service', 5, 0, '🧰', { taxable: false, tags: ['service'] }],
    ['Extended Warranty – 12 months', 'b_phoneman', 'cat_service', 79, 10, '🛡️', { taxable: false, tags: ['service'] }],
    ['Prepaid SIM Card', 'b_generic', 'cat_sim', 10, 3, '📶', { supplierId: 'sup_2' }],
    ['Top-up $25', 'b_generic', 'cat_sim', 25, 23.5, '📶', { taxable: false }],
    ['Top-up $50', 'b_generic', 'cat_sim', 50, 47, '📶', { taxable: false }],
    ['eSIM Activation', 'b_phoneman', 'cat_sim', 15, 0, '📶', { taxable: false, tags: ['service'] }],
  ]

  const products: Product[] = seeds.map((s, i) => {
    const [name, brandId, categoryId, price, cost, emoji, extra] = s
    const isService = categoryId === 'cat_service' || (categoryId === 'cat_sim' && cost === 0)
    const isPhone = categoryId === 'cat_phones' || categoryId === 'cat_tablets' || categoryId === 'cat_wear'
    const trackSerial = extra.trackSerial ?? isPhone
    const baseStock = isService ? 999 : isPhone ? rint(2, 14) : rint(6, 80)
    const serials = trackSerial ? Array.from({ length: baseStock }, () => generateIMEI(r)) : []
    return {
      id: `p_${pad(i + 1, 3)}`,
      sku: `${categoryId.replace('cat_', '').toUpperCase().slice(0, 3)}-${pad(1000 + i, 4)}`,
      barcode: generateBarcode(r),
      name,
      brandId,
      categoryId,
      description: `${name} — genuine product, includes 12-month store warranty.`,
      price,
      cost,
      taxable: extra.taxable ?? true,
      stock: baseStock,
      lowStockThreshold: isPhone ? 3 : 8,
      trackSerial,
      serials,
      attrs: extra.attrs ?? {},
      emoji,
      active: true,
      tags: extra.tags ?? [],
      supplierId: extra.supplierId,
      createdAt: iso(start),
      updatedAt: iso(start),
      soldCount: 0,
    }
  })
  // deliberately create a few low / out of stock items
  const lowIds = ['p_001', 'p_007', 'p_026', 'p_034', 'p_040', 'p_044']
  lowIds.forEach((id) => {
    const p = products.find((x) => x.id === id)!
    p.stock = id === 'p_026' || id === 'p_040' ? 0 : 2
    p.serials = p.serials.slice(0, p.stock)
  })

  // ── Customers ────────────────────────────────────────────────────────────
  const firstNames = ['Emma','Liam','Olivia','Noah','Ava','Ethan','Sophia','Mason','Isabella','Lucas','Mia','Logan','Amelia','James','Harper','Benjamin','Evelyn','Elijah','Abigail','Daniel','Chloe','Aiden','Grace','Carter','Zoe','Owen','Lily','Wyatt','Nora','Jack','Aria','Luke','Layla','Henry','Ella','Sebastian','Hannah','Gabriel','Scarlett','Mateo','Camila','Diego','Fatima','Yusuf','Aisha','Kenji','Hana','Ravi','Ananya','Tomas']
  const lastNames = ['Johnson','Smith','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green']
  const customers: Customer[] = Array.from({ length: 48 }, (_, i) => {
    const name = `${firstNames[i % firstNames.length]} ${lastNames[(i * 7) % lastNames.length]}`
    return {
      id: `c_${pad(i + 1, 3)}`,
      name,
      phone: `+1 555 ${pad(rint(100, 999), 3)} ${pad(rint(1000, 9999), 4)}`,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
      loyaltyPoints: 0,
      storeCredit: i % 9 === 0 ? rint(10, 80) : 0,
      totalSpent: 0,
      visits: 0,
      tags: i % 6 === 0 ? ['vip'] : i % 11 === 0 ? ['business'] : [],
      createdAt: iso(addDays(start, rint(0, 60))),
      notes: i % 10 === 0 ? 'Prefers text message notifications.' : undefined,
    }
  })

  // ── Registers ────────────────────────────────────────────────────────────
  const registers: Register[] = [
    { id: 'reg_1', name: 'Register 1', location: 'Front counter', active: true, color: '#2563eb' },
    { id: 'reg_2', name: 'Register 2', location: 'Front counter', active: true, color: '#7c3aed' },
    { id: 'reg_3', name: 'Register 3', location: 'Repair desk', active: true, color: '#059669' },
  ]

  // ── Transaction history ──────────────────────────────────────────────────
  const transactions: Transaction[] = []
  const stockMovements: StockMovement[] = []
  const activity: ActivityLog[] = []
  const shifts: Shift[] = []
  const cashiers = users.filter((u) => u.role === 'cashier' && u.active)
  let txNo = 1
  const settings = { ...DEFAULT_SETTINGS }

  const log = (userId: string, action: string, entity: string, entityId: string | undefined, description: string, createdAt: string, severity: ActivityLog['severity'] = 'info', registerId?: string, meta?: Record<string, unknown>) => {
    const u = users.find((x) => x.id === userId)!
    activity.push({ id: uid('act'), userId, userName: u.name, action, entity, entityId, description, createdAt, severity, registerId, meta })
  }

  // initial stock movements
  products.forEach((p) => {
    if (p.categoryId === 'cat_service') return
    stockMovements.push({ id: uid('sm'), productId: p.id, type: 'initial', qty: p.stock, before: 0, after: p.stock, reason: 'Opening stock', userId: 'u_admin', createdAt: iso(start) })
  })
  log('u_admin', 'system.seeded', 'system', undefined, 'Store initialised with opening catalog and stock', iso(start))

  const weights = products.map((p) => {
    if (p.categoryId === 'cat_phones') return 1.6
    if (p.categoryId === 'cat_cases' || p.categoryId === 'cat_charge') return 3.2
    if (p.categoryId === 'cat_audio') return 1.4
    if (p.categoryId === 'cat_service') return 1.2
    if (p.categoryId === 'cat_sim') return 1.5
    return 1
  })
  const totalW = weights.reduce((a, b) => a + b, 0)
  const weightedPick = () => {
    let x = r() * totalW
    for (let i = 0; i < products.length; i++) {
      x -= weights[i]!
      if (x <= 0) return products[i]!
    }
    return products[products.length - 1]!
  }

  const methods: PaymentMethod[] = ['cash', 'card', 'card', 'card', 'mobile', 'cash']
  const dayCount = 121 // includes today (partial)
  for (let d = 0; d < dayCount; d++) {
    const date = addDays(start, d)
    const dow = date.getDay()
    if (date > now) break
    // growth trend + weekend bump
    const base = 6 + Math.floor(d / 12) + (dow === 6 ? 5 : dow === 0 ? -2 : dow === 5 ? 2 : 0)
    const nTx = Math.max(2, base + rint(-3, 3))
    const activeRegs = dow === 0 ? [registers[0]!] : registers.slice(0, dow === 6 ? 3 : 2)

    // shifts for the day
    const dayShifts: Shift[] = activeRegs.map((reg, idx) => {
      const cashier = cashiers[(d + idx) % cashiers.length]!
      const opened = sinceStart(d, 9, rint(0, 20))
      const s: Shift = {
        id: uid('sh'), registerId: reg.id, userId: cashier.id, status: 'closed', openedAt: iso(opened),
        openingFloat: 200, cashMovements: [], salesTotal: 0, salesCount: 0, refundsTotal: 0, refundsCount: 0, cashSales: 0, cardSales: 0, otherSales: 0,
      }
      log(cashier.id, 'shift.opened', 'shift', s.id, `Opened ${reg.name} with float ${settings.currencySymbol}200.00`, s.openedAt, 'info', reg.id)
      return s
    })

    for (let t = 0; t < nTx; t++) {
      const shift = pick(dayShifts)
      const cashier = users.find((u) => u.id === shift.userId)!
      const hour = rint(9, 19)
      const minute = rint(0, 59)
      const when = sinceStart(d, hour, minute)
      if (when > now) continue
      const nLines = r() < 0.55 ? 1 : r() < 0.8 ? 2 : rint(3, 5)
      const chosen: Product[] = []
      for (let i = 0; i < nLines; i++) {
        const p = weightedPick()
        if (!chosen.includes(p)) chosen.push(p)
      }
      const customer = r() < 0.55 ? pick(customers) : undefined
      const lines = chosen.map((p) => {
        const qty = p.categoryId === 'cat_phones' || p.trackSerial ? 1 : r() < 0.8 ? 1 : rint(2, 3)
        const serial = p.trackSerial ? generateIMEI(r) : undefined
        const disc = r() < 0.12 ? { type: 'percent' as const, value: pick([5, 10, 15]) } : undefined
        return { id: uid('ln'), productId: p.id, name: p.name, sku: p.sku, emoji: p.emoji, unitPrice: p.price, originalPrice: p.price, qty, discount: disc, taxable: p.taxable, serial }
      })
      const cartDiscount = r() < 0.06 ? { type: 'fixed' as const, value: pick([5, 10, 20]) } : undefined
      const totals = calcCart({ lines, discount: cartDiscount }, settings)
      const txLines: TransactionLine[] = lines.map((l) => {
        const lt = totals.lines[l.id]!
        const prod = products.find((x) => x.id === l.productId)!
        return { id: l.id, productId: l.productId, name: l.name, sku: l.sku, emoji: l.emoji, unitPrice: l.unitPrice, originalPrice: l.originalPrice, qty: l.qty, discount: l.discount, discountAmount: round2(lt.gross - lt.net), taxable: l.taxable, taxAmount: lt.tax, lineTotal: lt.total, serial: l.serial, refundedQty: 0, cost: prod.cost }
      })
      const method = pick(methods)
      const isSplit = totals.total > 400 && r() < 0.15
      const payments: Payment[] = isSplit
        ? [
            { id: uid('pay'), method: 'cash', amount: round2(Math.floor(totals.total / 2)), tendered: round2(Math.floor(totals.total / 2)), createdAt: iso(when) },
            { id: uid('pay'), method: 'card', amount: round2(totals.total - Math.floor(totals.total / 2)), cardLast4: pad(rint(0, 9999), 4), createdAt: iso(when) },
          ]
        : method === 'cash'
          ? (() => { const tendered = Math.ceil(totals.total / 10) * 10; return [{ id: uid('pay'), method: 'cash' as const, amount: totals.total, tendered, createdAt: iso(when) }] })()
          : [{ id: uid('pay'), method, amount: totals.total, cardLast4: method === 'card' ? pad(rint(0, 9999), 4) : undefined, reference: method === 'mobile' ? `MP-${pad(rint(0, 999999), 6)}` : undefined, createdAt: iso(when) }]
      const change = round2(payments.reduce((a, p) => a + (p.tendered ?? p.amount), 0) - totals.total)
      const loyaltyEarned = customer ? Math.floor(totals.total * settings.loyaltyPointsPerCurrency) : 0
      const tx: Transaction = {
        id: uid('tx'), number: `${settings.numberPrefix}-${pad(txNo++)}`, type: 'sale', status: 'completed', registerId: shift.registerId, shiftId: shift.id,
        userId: cashier.id, customerId: customer?.id, lines: txLines, subtotal: totals.subtotal, discountTotal: totals.discountTotal, cartDiscount, taxTotal: totals.tax,
        total: totals.total, payments, change, createdAt: iso(when), loyaltyEarned, loyaltyRedeemed: 0, costTotal: round2(txLines.reduce((a, l) => a + l.cost * l.qty, 0)),
      }
      transactions.push(tx)
      shift.salesTotal = round2(shift.salesTotal + tx.total)
      shift.salesCount++
      payments.forEach((p) => {
        if (p.method === 'cash') shift.cashSales = round2(shift.cashSales + p.amount)
        else if (p.method === 'card') shift.cardSales = round2(shift.cardSales + p.amount)
        else shift.otherSales = round2(shift.otherSales + p.amount)
      })
      if (customer) {
        customer.totalSpent = round2(customer.totalSpent + tx.total)
        customer.visits++
        customer.loyaltyPoints += loyaltyEarned
        customer.lastVisitAt = tx.createdAt
      }
      txLines.forEach((l) => {
        const p = products.find((x) => x.id === l.productId)!
        p.soldCount += l.qty
        if (p.categoryId !== 'cat_service') {
          // We keep current stock as the "after-all-history" number; history movements are recorded relative to it later
          stockMovements.push({ id: uid('sm'), productId: p.id, type: 'sale', qty: -l.qty, before: 0, after: 0, refId: tx.id, userId: cashier.id, createdAt: tx.createdAt, serial: l.serial })
        }
      })
      log(cashier.id, 'sale.completed', 'transaction', tx.id, `Sale ${tx.number} · ${txLines.length} item(s) · ${settings.currencySymbol}${tx.total.toFixed(2)}`, tx.createdAt, 'info', shift.registerId, { total: tx.total })
      if (tx.discountTotal > 0) log(cashier.id, 'sale.discount', 'transaction', tx.id, `Discount of ${settings.currencySymbol}${tx.discountTotal.toFixed(2)} applied on ${tx.number}`, tx.createdAt, tx.discountTotal > 30 ? 'warning' : 'info', shift.registerId)

      // occasional refunds a few days later
      if (r() < 0.045 && d < dayCount - 3) {
        const refundWhen = addDays(when, rint(1, 5))
        if (refundWhen < now) {
          const rl = txLines[0]!
          const refundLines: TransactionLine[] = [{ ...rl, id: uid('ln'), qty: -1, lineTotal: -round2(rl.lineTotal / rl.qty), taxAmount: -round2(rl.taxAmount / rl.qty), discountAmount: -round2(rl.discountAmount / rl.qty), refundedQty: 0 }]
          const refundTotal = refundLines[0]!.lineTotal
          const mgr = 'u_mgr'
          const rtx: Transaction = {
            id: uid('tx'), number: `${settings.numberPrefix}-${pad(txNo++)}`, type: 'refund', status: 'completed', registerId: shift.registerId, shiftId: undefined, userId: cashier.id, customerId: customer?.id,
            lines: refundLines, subtotal: -round2(rl.unitPrice), discountTotal: -round2(rl.discountAmount / rl.qty), taxTotal: refundLines[0]!.taxAmount, total: refundTotal,
            payments: [{ id: uid('pay'), method: payments[0]!.method, amount: refundTotal, createdAt: iso(refundWhen) }], change: 0, createdAt: iso(refundWhen), refundOf: tx.id,
            note: pick(['Customer changed mind', 'Defective on arrival', 'Wrong model purchased', 'Did not fit device']), loyaltyEarned: 0, loyaltyRedeemed: 0, costTotal: -rl.cost,
          }
          transactions.push(rtx)
          rl.refundedQty = 1
          tx.status = rl.qty === 1 && txLines.length === 1 ? 'refunded' : 'partially_refunded'
          const p = products.find((x) => x.id === rl.productId)!
          p.soldCount -= 1
          if (p.categoryId !== 'cat_service') stockMovements.push({ id: uid('sm'), productId: p.id, type: 'refund', qty: 1, before: 0, after: 0, refId: rtx.id, userId: cashier.id, createdAt: rtx.createdAt, serial: rl.serial })
          if (customer) customer.totalSpent = round2(customer.totalSpent + refundTotal)
          log(cashier.id, 'refund.completed', 'transaction', rtx.id, `Refund ${rtx.number} for ${tx.number} · ${settings.currencySymbol}${Math.abs(refundTotal).toFixed(2)} (${rtx.note})`, rtx.createdAt, Math.abs(refundTotal) > settings.largeRefundThreshold ? 'warning' : 'info', shift.registerId, { approvedBy: mgr })
        }
      }
    }

    // close the shifts
    dayShifts.forEach((s) => {
      const closed = sinceStart(d, 20, rint(0, 40))
      if (closed > now) { s.status = 'open'; shifts.push(s); return }
      if (r() < 0.25) {
        const mv = { id: uid('cm'), type: 'out' as const, amount: pick([20, 50, 100]), reason: pick(['Petty cash – supplies', 'Bank drop', 'Courier fee']), userId: s.userId, createdAt: iso(sinceStart(d, 14, 0)) }
        s.cashMovements.push(mv)
        log(s.userId, 'cash.out', 'shift', s.id, `Cash out ${settings.currencySymbol}${mv.amount.toFixed(2)} – ${mv.reason}`, mv.createdAt, 'info', s.registerId)
      }
      const expected = round2(s.openingFloat + s.cashSales - s.cashMovements.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0) + s.cashMovements.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0))
      const variance = r() < 0.15 ? pick([-20, -10, -5, 5, 10]) : 0
      s.closedAt = iso(closed)
      s.expectedCash = expected
      s.closingCount = round2(expected + variance)
      s.difference = variance
      log(s.userId, 'shift.closed', 'shift', s.id, `Closed ${registers.find((x) => x.id === s.registerId)!.name} · sales ${settings.currencySymbol}${s.salesTotal.toFixed(2)} · variance ${settings.currencySymbol}${variance.toFixed(2)}`, s.closedAt, variance !== 0 ? 'warning' : 'info', s.registerId)
      shifts.push(s)
    })
  }
  settings.nextTransactionNumber = txNo

  // Fix stock movement before/after by replaying backwards from current stock
  const byProduct = new Map<string, StockMovement[]>()
  stockMovements.forEach((m) => { const arr = byProduct.get(m.productId) ?? []; arr.push(m); byProduct.set(m.productId, arr) })
  byProduct.forEach((list, pid) => {
    const p = products.find((x) => x.id === pid)!
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    // total delta after initial equals current - initial => scale initial so that the chain lands on current stock
    const nonInitial = list.filter((m) => m.type !== 'initial')
    const deltas = nonInitial.reduce((a, m) => a + m.qty, 0)
    let prefix = 0
    let minPrefix = 0
    nonInitial.forEach((m) => { prefix += m.qty; minPrefix = Math.min(minPrefix, prefix) })
    const initial = list.find((m) => m.type === 'initial')
    if (initial) { initial.qty = Math.max(0, p.stock - deltas, -minPrefix); initial.after = initial.qty }
    let running = 0
    list.forEach((m) => { m.before = running; running += m.qty; m.after = running })
    if (running !== p.stock) {
      p.stock = running
      if (p.trackSerial) { while (p.serials.length < running) p.serials.push(generateIMEI(r)); p.serials = p.serials.slice(0, running) }
    }
  })

  // ── Promotions ───────────────────────────────────────────────────────────
  const promotions: Promotion[] = [
    { id: 'promo_1', name: 'Accessory Bundle – 20% off 2+', code: 'BUNDLE20', type: 'percent', value: 20, scope: 'category', targetIds: ['cat_cases', 'cat_charge'], minQty: 2, startsAt: iso(addDays(now, -30)), endsAt: iso(addDays(now, 30)), active: true, usageCount: 42, description: 'Buy any 2 cases or chargers and get 20% off.' },
    { id: 'promo_2', name: 'Screen Protector BOGO', code: 'BOGOGLASS', type: 'bogo', value: 0, scope: 'product', targetIds: ['p_040', 'p_041', 'p_042'], minQty: 2, startsAt: iso(addDays(now, -10)), endsAt: iso(addDays(now, 20)), active: true, usageCount: 17 },
    { id: 'promo_3', name: 'Back to School – $50 off tablets', code: 'SCHOOL50', type: 'fixed', value: 50, scope: 'category', targetIds: ['cat_tablets'], startsAt: iso(addDays(now, -60)), endsAt: iso(addDays(now, -20)), active: false, usageCount: 23 },
    { id: 'promo_4', name: 'Loyalty Weekend – 10% storewide', code: 'LOYAL10', type: 'percent', value: 10, scope: 'all', targetIds: [], startsAt: iso(addDays(now, 3)), endsAt: iso(addDays(now, 5)), active: true, usageCount: 0 },
  ]

  // ── Purchase orders ──────────────────────────────────────────────────────
  let poNo = 1
  const mkPO = (supplierId: string, status: PurchaseOrder['status'], daysAgoN: number, items: Array<[string, number]>): PurchaseOrder => {
    const createdAt = iso(addDays(now, -daysAgoN))
    const po: PurchaseOrder = {
      id: uid('po'), number: `PO-${pad(poNo++, 4)}`, supplierId, status, createdAt, expectedAt: iso(addDays(now, -daysAgoN + 7)), userId: 'u_mgr',
      lines: items.map(([pid, qty]) => { const p = products.find((x) => x.id === pid)!; return { id: uid('pol'), productId: pid, qty, cost: p.cost, received: status === 'received' ? qty : status === 'partial' ? Math.floor(qty / 2) : 0 } }),
      receivedAt: status === 'received' ? iso(addDays(now, -daysAgoN + 5)) : undefined,
    }
    log('u_mgr', 'po.created', 'purchase_order', po.id, `Purchase order ${po.number} created for ${suppliers.find((s) => s.id === supplierId)!.name}`, createdAt)
    if (status === 'received') log('u_mgr', 'po.received', 'purchase_order', po.id, `Purchase order ${po.number} fully received`, po.receivedAt!)
    return po
  }
  const purchaseOrders: PurchaseOrder[] = [
    mkPO('sup_1', 'received', 45, [['p_001', 10], ['p_003', 8], ['p_026', 20]]),
    mkPO('sup_3', 'received', 30, [['p_034', 40], ['p_040', 100], ['p_044', 60], ['p_048', 100]]),
    mkPO('sup_1', 'partial', 8, [['p_007', 6], ['p_012', 6], ['p_022', 5]]),
    mkPO('sup_1', 'ordered', 3, [['p_001', 8], ['p_026', 25], ['p_002', 5]]),
    mkPO('sup_3', 'draft', 1, [['p_040', 150], ['p_044', 80], ['p_034', 30]]),
  ]
  settings.nextPONumber = poNo

  // ── Repairs ──────────────────────────────────────────────────────────────
  let repNo = 1
  const mkRepair = (ci: number, device: string, issue: string, status: RepairTicket['status'], daysAgoN: number, estimate: number, deposit: number, tech = 'u_c3'): RepairTicket => {
    const createdAt = iso(addDays(now, -daysAgoN))
    const t: RepairTicket = { id: uid('rep'), number: `RP-${pad(repNo++, 4)}`, customerId: customers[ci]!.id, device, imei: generateIMEI(r), issue, status, estimate, deposit, technicianId: tech, createdAt, updatedAt: iso(addDays(now, -Math.max(0, daysAgoN - 2))), promisedAt: iso(addDays(now, -daysAgoN + 3)), paid: status === 'collected', notes: [{ id: uid('rn'), userId: tech, text: 'Device received, initial inspection done.', createdAt }] }
    log('u_c3', 'repair.created', 'repair', t.id, `Repair ticket ${t.number} opened – ${device}: ${issue}`, createdAt, 'info', 'reg_3')
    return t
  }
  const repairs: RepairTicket[] = [
    mkRepair(3, 'iPhone 13', 'Cracked screen', 'ready', 4, 129, 50),
    mkRepair(7, 'Galaxy S22', 'Battery drains fast', 'in_progress', 2, 69, 0),
    mkRepair(12, 'Pixel 7', 'Charging port loose', 'waiting_parts', 6, 59, 20),
    mkRepair(15, 'iPhone 12 Pro', 'Water damage – no power', 'diagnosing', 1, 39, 39),
    mkRepair(19, 'iPhone 15', 'Back glass shattered', 'received', 0, 189, 0),
    mkRepair(22, 'Galaxy A54', 'Screen flickering', 'collected', 12, 149, 149),
    mkRepair(27, 'OnePlus 11', 'Speaker not working', 'collected', 20, 79, 79),
    mkRepair(31, 'iPad 9th gen', 'Cracked screen', 'cancelled', 9, 159, 0),
  ]
  settings.nextRepairNumber = repNo

  // ── Alerts ───────────────────────────────────────────────────────────────
  const alerts: Alert[] = []
  products.filter((p) => p.categoryId !== 'cat_service' && p.stock <= p.lowStockThreshold).forEach((p) => {
    alerts.push({ id: uid('al'), type: p.stock === 0 ? 'out_of_stock' : 'low_stock', title: p.stock === 0 ? 'Out of stock' : 'Low stock', message: `${p.name} — ${p.stock} left (threshold ${p.lowStockThreshold})`, severity: p.stock === 0 ? 'critical' : 'warning', read: false, createdAt: iso(addDays(now, -1)), link: `/admin/catalog/${p.id}` })
  })
  shifts.filter((s) => s.difference && Math.abs(s.difference) >= 10).slice(-3).forEach((s) => {
    alerts.push({ id: uid('al'), type: 'shift_variance', title: 'Cash drawer variance', message: `${registers.find((x) => x.id === s.registerId)!.name} closed with ${s.difference! > 0 ? 'surplus' : 'shortage'} of ${settings.currencySymbol}${Math.abs(s.difference!).toFixed(2)}`, severity: 'warning', read: false, createdAt: s.closedAt!, link: '/admin/shifts' })
  })
  repairs.filter((x) => x.status === 'ready').forEach((x) => alerts.push({ id: uid('al'), type: 'repair_ready', title: 'Repair ready for pickup', message: `${x.number} · ${x.device} is ready. Notify ${customers.find((c) => c.id === x.customerId)!.name}.`, severity: 'info', read: false, createdAt: x.updatedAt, link: '/admin/repairs' }))
  alerts.push({ id: uid('al'), type: 'system', title: 'Welcome to Phone man POS', message: 'Demo data has been loaded. You can reset it anytime from Settings → Data.', severity: 'info', read: true, createdAt: iso(now) })

  activity.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  transactions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    version: DB_VERSION,
    seededAt: iso(now),
    users, categories, brands, suppliers, products, customers, registers, shifts, transactions, stockMovements, activity,
    promotions, purchaseOrders, repairs, alerts, settings,
    carts: [],
    displays: registers.map((rg) => ({ registerId: rg.id, phase: 'idle' as const, updatedAt: iso(now) })),
  }
}
