import type { Cart, CartLine, LineDiscount, Promotion, Settings, Product, TransactionLine } from './types'
import { round2 } from './utils'

export interface LineTotals {
  gross: number // unitPrice * qty
  discount: number
  net: number // gross - discount (ex tax)
  tax: number
  total: number // net + tax
}

export interface CartTotals {
  subtotal: number // sum of gross (ex tax)
  lineDiscounts: number
  cartDiscount: number
  promoDiscount: number
  discountTotal: number
  taxableBase: number
  tax: number
  total: number
  itemCount: number
  lines: Record<string, LineTotals>
}

export function discountAmount(base: number, d?: LineDiscount): number {
  if (!d || !d.value) return 0
  if (d.type === 'percent') return round2(base * Math.min(100, Math.max(0, d.value)) / 100)
  return round2(Math.min(base, Math.max(0, d.value)))
}

export function promotionForCart(promo: Promotion | undefined, lines: CartLine[], products: Product[]): number {
  if (!promo || !promo.active) return 0
  const now = Date.now()
  if (new Date(promo.startsAt).getTime() > now || new Date(promo.endsAt).getTime() < now) return 0
  const eligible = lines.filter((l) => {
    if (l.isRefund) return false
    if (promo.scope === 'all') return true
    const p = products.find((x) => x.id === l.productId)
    if (!p) return false
    if (promo.scope === 'category') return promo.targetIds.includes(p.categoryId)
    return promo.targetIds.includes(p.id)
  })
  if (!eligible.length) return 0
  const qty = eligible.reduce((a, l) => a + l.qty, 0)
  if (promo.minQty && qty < promo.minQty) return 0
  const base = eligible.reduce((a, l) => a + l.unitPrice * l.qty - discountAmount(l.unitPrice * l.qty, l.discount), 0)
  switch (promo.type) {
    case 'percent':
      return round2(base * promo.value / 100)
    case 'fixed':
      return round2(Math.min(base, promo.value))
    case 'bogo': {
      // buy one get one: cheapest of each pair free
      const units: number[] = []
      eligible.forEach((l) => {
        for (let i = 0; i < l.qty; i++) units.push(l.unitPrice)
      })
      units.sort((a, b) => b - a)
      let free = 0
      for (let i = 1; i < units.length; i += 2) free += units[i]!
      return round2(free)
    }
    case 'bundle':
      return qty >= (promo.minQty ?? 2) ? round2(Math.min(base, promo.value)) : 0
    default:
      return 0
  }
}

export function calcCart(cart: Pick<Cart, 'lines' | 'discount'>, settings: Settings, promo?: Promotion, products: Product[] = []): CartTotals {
  const lines: Record<string, LineTotals> = {}
  let subtotal = 0
  let lineDiscounts = 0
  const sign = (l: CartLine) => (l.isRefund ? -1 : 1)

  // First pass: line-level
  const netByLine: Record<string, number> = {}
  for (const l of cart.lines) {
    const gross = round2(l.unitPrice * l.qty) * sign(l)
    const disc = discountAmount(Math.abs(gross), l.discount) * sign(l)
    const net = round2(gross - disc)
    subtotal += gross
    lineDiscounts += disc
    netByLine[l.id] = net
  }
  const netSum = round2(subtotal - lineDiscounts)
  const positiveNet = cart.lines.filter((l) => !l.isRefund).reduce((a, l) => a + netByLine[l.id]!, 0)

  // Cart-level discount & promo, distributed proportionally across non-refund lines
  const cartDiscount = discountAmount(Math.max(0, positiveNet), cart.discount)
  const promoDiscount = Math.min(Math.max(0, positiveNet - cartDiscount), promotionForCart(promo, cart.lines, products))
  const globalDisc = cartDiscount + promoDiscount

  let tax = 0
  let total = 0
  let taxableBase = 0
  let itemCount = 0
  const rate = settings.taxRate / 100
  for (const l of cart.lines) {
    const gross = round2(l.unitPrice * l.qty) * sign(l)
    const lineDisc = discountAmount(Math.abs(gross), l.discount) * sign(l)
    let net = netByLine[l.id]!
    if (!l.isRefund && positiveNet > 0 && globalDisc > 0) {
      const share = round2((net / positiveNet) * globalDisc)
      net = round2(net - share)
    }
    let lineTax = 0
    if (l.taxable) {
      if (settings.taxInclusive) {
        lineTax = round2(net - net / (1 + rate))
      } else {
        lineTax = round2(net * rate)
      }
      taxableBase += net
    }
    const lineTotal = settings.taxInclusive ? net : round2(net + lineTax)
    lines[l.id] = { gross, discount: lineDisc, net, tax: lineTax, total: lineTotal }
    tax += lineTax
    total += lineTotal
    itemCount += l.qty * sign(l)
  }

  return {
    subtotal: round2(subtotal),
    lineDiscounts: round2(lineDiscounts),
    cartDiscount: round2(cartDiscount),
    promoDiscount: round2(promoDiscount),
    discountTotal: round2(lineDiscounts + cartDiscount + promoDiscount),
    taxableBase: round2(taxableBase),
    tax: round2(tax),
    total: round2(total),
    itemCount,
    lines,
  }
}

export function toTransactionLines(cart: Cart, totals: CartTotals, products: Product[]): TransactionLine[] {
  return cart.lines.map((l) => {
    const t = totals.lines[l.id]!
    const p = products.find((x) => x.id === l.productId)
    return {
      id: l.id,
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      emoji: l.emoji,
      unitPrice: l.unitPrice,
      originalPrice: l.originalPrice,
      qty: l.isRefund ? -l.qty : l.qty,
      discount: l.discount,
      discountAmount: round2(Math.abs(t.gross) - Math.abs(t.net)),
      taxable: l.taxable,
      taxAmount: t.tax,
      lineTotal: t.total,
      serial: l.serial,
      refundedQty: 0,
      cost: p?.cost ?? 0,
    }
  })
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile: 'Mobile Pay',
  store_credit: 'Store Credit',
  gift_card: 'Gift Card',
  bank_transfer: 'Bank Transfer',
}

export const CASH_DENOMINATIONS = [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01]

export function quickCashOptions(total: number): number[] {
  const opts = new Set<number>()
  opts.add(round2(total))
  const roundUps = [1, 5, 10, 20, 50, 100, 200, 500]
  for (const r of roundUps) {
    const v = Math.ceil(total / r) * r
    if (v > total) opts.add(v)
    if (opts.size >= 6) break
  }
  return Array.from(opts).sort((a, b) => a - b).slice(0, 6)
}
