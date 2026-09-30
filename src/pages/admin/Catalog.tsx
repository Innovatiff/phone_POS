import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Upload, Download, Tags, Award, LayoutGrid, List, Trash2, Pencil, Check, X, Wand2, Package, AlertTriangle,
  PackageX, CircleDollarSign, CheckCircle2, Percent, FolderInput, Power, PowerOff,
} from 'lucide-react'
import { useDB } from '@/store/db'
import { useAdminUser } from '@/store/session'
import type { Product, Category, Brand, ID, ProductVariantAttr } from '@/lib/types'
import { money, cx, toCSV, parseCSV, downloadFile, round2, generateBarcode } from '@/lib/utils'
import { inventoryValue } from '@/lib/analytics'
import {
  PageHeader, Badge, SearchInput, Select, Segmented, DataTable, Modal, Drawer, Field, Input, Textarea, Toggle, confirm, toast,
  EmptyState, type Column,
} from '@/components/ui'

// ─── Shared helpers (also used by ProductDetail / Inventory) ─────────────────
export type StockStatus = 'in' | 'low' | 'out' | 'na'
export function stockStatus(p: Pick<Product, 'stock' | 'lowStockThreshold' | 'categoryId'>): StockStatus {
  if (p.categoryId === 'cat_service') return 'na'
  if (p.stock <= 0) return 'out'
  if (p.stock <= p.lowStockThreshold) return 'low'
  return 'in'
}
export function marginPct(price: number, cost: number): number {
  if (!price) return 0
  return round2(((price - cost) / price) * 100)
}
export function attrsLabel(a: ProductVariantAttr | undefined): string[] {
  if (!a) return []
  return [a.storage, a.color, a.size, a.condition && a.condition !== 'new' ? a.condition : undefined].filter((x): x is string => !!x)
}
export function CategoryBadge({ category, className }: { category?: Category; className?: string }) {
  if (!category) return <Badge>—</Badge>
  return (
    <span className={cx('badge whitespace-nowrap', className)} style={{ background: `${category.color}1a`, color: category.color }}>
      <span className="mr-1">{category.icon}</span>{category.name}
    </span>
  )
}
export function StockPill({ p }: { p: Product }) {
  const s = stockStatus(p)
  if (s === 'na') return <Badge tone="slate">Service</Badge>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('font-semibold tabular-nums', s === 'out' ? 'text-red-600' : s === 'low' ? 'text-amber-600' : 'text-slate-800')}>{p.stock}</span>
      {s === 'out' && <Badge tone="red">Out</Badge>}
      {s === 'low' && <Badge tone="amber">Low</Badge>}
      {p.trackSerial && <span className="badge bg-slate-100 text-slate-500 !px-1.5">IMEI</span>}
    </span>
  )
}
export const EMOJI_CHOICES = ['📱', '📟', '⌚', '🎧', '🔊', '🎒', '🛡️', '🔌', '🔋', '💾', '📶', '💳', '🖥️', '⌨️', '🖱️', '📷', '🎮', '🔧', '🧰', '🧲', '💡', '🧴', '📦', '🎁']

// ─── Page ────────────────────────────────────────────────────────────────────
type StatusFilter = 'all' | 'active' | 'inactive'
type StockFilter = 'all' | 'in' | 'low' | 'out'

export default function Catalog() {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const navigate = useNavigate()
  const upsertProduct = useDB((s) => s.upsertProduct)
  const deleteProduct = useDB((s) => s.deleteProduct)
  const bulkUpdateProducts = useDB((s) => s.bulkUpdateProducts)
  const upsertCategory = useDB((s) => s.upsertCategory)
  const upsertBrand = useDB((s) => s.upsertBrand)

  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [brand, setBrand] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [stock, setStock] = useState<StockFilter>('all')
  const [view, setView] = useState<'table' | 'grid'>('table')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<{ open: boolean; product?: Product }>({ open: false })
  const [catsOpen, setCatsOpen] = useState(false)
  const [brandsOpen, setBrandsOpen] = useState(false)
  const [bulkCat, setBulkCat] = useState(false)
  const [bulkPrice, setBulkPrice] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const catById = useMemo(() => Object.fromEntries(db.categories.map((c) => [c.id, c])) as Record<ID, Category>, [db.categories])
  const brandById = useMemo(() => Object.fromEntries(db.brands.map((b) => [b.id, b])) as Record<ID, Brand>, [db.brands])

  const inv = useMemo(() => inventoryValue(db.products), [db.products])
  const activeCount = db.products.filter((p) => p.active).length

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return db.products.filter((p) => {
      if (term && !(p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcode.includes(term) || p.tags.some((t) => t.toLowerCase().includes(term)) || attrsLabel(p.attrs).join(' ').toLowerCase().includes(term))) return false
      if (cat && p.categoryId !== cat) return false
      if (brand && p.brandId !== brand) return false
      if (status === 'active' && !p.active) return false
      if (status === 'inactive' && p.active) return false
      if (stock !== 'all') {
        const s = stockStatus(p)
        if (stock === 'in' && s !== 'in') return false
        if (stock === 'low' && s !== 'low') return false
        if (stock === 'out' && s !== 'out') return false
      }
      return true
    })
  }, [db.products, q, cat, brand, status, stock])

  const selectedProducts = useMemo(() => db.products.filter((p) => selected.has(p.id)), [db.products, selected])

  // ── CSV import / export ──
  const exportCSV = () => {
    const rows = filtered.map((p) => ({
      name: p.name, sku: p.sku, barcode: p.barcode, price: p.price, cost: p.cost, category: catById[p.categoryId]?.name ?? '', brand: brandById[p.brandId]?.name ?? '',
      stock: p.stock, emoji: p.emoji, lowStockThreshold: p.lowStockThreshold, trackSerial: p.trackSerial ? 'yes' : 'no', active: p.active ? 'yes' : 'no', tags: p.tags.join('|'),
      storage: p.attrs.storage ?? '', color: p.attrs.color ?? '', condition: p.attrs.condition ?? '',
    }))
    downloadFile(`catalog-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows), 'text/csv')
    toast.success(`Exported ${rows.length} products`)
  }
  const importCSV = async (file: File) => {
    const text = await file.text()
    const rows = parseCSV(text)
    if (!rows.length) { toast.error('The CSV file is empty or has no header row'); return }
    let created = 0, updated = 0, skipped = 0
    const findOrCreateCategory = (name: string): ID | undefined => {
      const n = name.trim()
      if (!n) return undefined
      const ex = useDB.getState().db.categories.find((c) => c.name.toLowerCase() === n.toLowerCase())
      if (ex) return ex.id
      upsertCategory({ name: n }, admin.id)
      return useDB.getState().db.categories.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id
    }
    const findOrCreateBrand = (name: string): ID | undefined => {
      const n = name.trim()
      if (!n) return undefined
      const ex = useDB.getState().db.brands.find((b) => b.name.toLowerCase() === n.toLowerCase())
      if (ex) return ex.id
      upsertBrand({ name: n }, admin.id)
      return useDB.getState().db.brands.find((b) => b.name.toLowerCase() === n.toLowerCase())?.id
    }
    for (const r of rows) {
      const name = (r.name ?? '').trim()
      if (!name) { skipped++; continue }
      const sku = (r.sku ?? '').trim()
      const barcode = (r.barcode ?? '').trim()
      const products = useDB.getState().db.products
      const existing = products.find((p) => (sku && p.sku.toLowerCase() === sku.toLowerCase()) || (barcode && p.barcode === barcode))
      const patch: Partial<Product> = { name }
      if (sku) patch.sku = sku
      if (barcode) patch.barcode = barcode
      if (r.price !== undefined && r.price !== '') patch.price = round2(Number(r.price) || 0)
      if (r.cost !== undefined && r.cost !== '') patch.cost = round2(Number(r.cost) || 0)
      if (r.emoji) patch.emoji = r.emoji
      const catId = r.category ? findOrCreateCategory(r.category) : undefined
      if (catId) patch.categoryId = catId
      const brandId = r.brand ? findOrCreateBrand(r.brand) : undefined
      if (brandId) patch.brandId = brandId
      if (r.stock !== undefined && r.stock !== '') patch.stock = Math.max(0, Math.round(Number(r.stock) || 0))
      if (r.lowStockThreshold) patch.lowStockThreshold = Number(r.lowStockThreshold) || 0
      if (r.trackSerial) patch.trackSerial = /^(yes|true|1)$/i.test(r.trackSerial)
      if (r.active) patch.active = /^(yes|true|1)$/i.test(r.active)
      if (r.tags) patch.tags = r.tags.split(/[|;]/).map((t) => t.trim()).filter(Boolean)
      const attrs: ProductVariantAttr = {}
      if (r.storage) attrs.storage = r.storage
      if (r.color) attrs.color = r.color
      if (r.condition && ['new', 'refurbished', 'open-box'].includes(r.condition)) attrs.condition = r.condition as ProductVariantAttr['condition']
      if (Object.keys(attrs).length) patch.attrs = { ...(existing?.attrs ?? {}), ...attrs }
      if (existing) { upsertProduct({ ...patch, id: existing.id }, admin.id); updated++ }
      else { upsertProduct(patch, admin.id); created++ }
    }
    toast.success(`Import complete: ${created} created, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`)
  }

  // ── Bulk actions ──
  const ids = Array.from(selected)
  const bulkActive = (active: boolean) => {
    bulkUpdateProducts(ids, { active }, admin.id)
    toast.success(`${ids.length} product(s) ${active ? 'activated' : 'deactivated'}`)
    setSelected(new Set())
  }
  const bulkDelete = async () => {
    if (!(await confirm(`Delete ${ids.length} product(s)?`, 'This permanently removes the products from the catalog. Past transactions keep their line history.', { danger: true, confirmLabel: 'Delete' }))) return
    ids.forEach((id) => deleteProduct(id, admin.id))
    toast.success(`Deleted ${ids.length} product(s)`)
    setSelected(new Set())
  }

  const columns: Column<Product>[] = [
    {
      key: 'name', header: 'Product', sortValue: (p) => p.name,
      render: (p) => (
        <div className="flex items-center gap-3 min-w-[220px]">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl shrink-0">{p.emoji}</div>
          <div className="min-w-0">
            <div className={cx('font-medium truncate', p.active ? 'text-slate-800' : 'text-slate-400 line-through')}>{p.name}</div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {attrsLabel(p.attrs).map((a) => <span key={a} className="text-[10px] font-medium text-slate-500 bg-slate-100 rounded px-1.5 py-px">{a}</span>)}
              {p.tags.slice(0, 2).map((t) => <span key={t} className="text-[10px] font-medium text-brand-700 bg-brand-50 rounded px-1.5 py-px">#{t}</span>)}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'sku', header: 'SKU / Barcode', sortValue: (p) => p.sku, render: (p) => <div className="font-mono text-xs"><div className="text-slate-700">{p.sku}</div><div className="text-slate-400">{p.barcode}</div></div> },
    { key: 'category', header: 'Category', sortValue: (p) => catById[p.categoryId]?.name ?? '', render: (p) => <CategoryBadge category={catById[p.categoryId]} /> },
    { key: 'brand', header: 'Brand', sortValue: (p) => brandById[p.brandId]?.name ?? '', render: (p) => <span className="text-slate-600">{brandById[p.brandId]?.name ?? '—'}</span> },
    { key: 'price', header: 'Price', align: 'right', sortValue: (p) => p.price, render: (p) => <span className="font-semibold tabular-nums">{money(p.price)}</span> },
    { key: 'cost', header: 'Cost', align: 'right', sortValue: (p) => p.cost, render: (p) => <span className="text-slate-500 tabular-nums">{money(p.cost)}</span> },
    {
      key: 'margin', header: 'Margin', align: 'right', sortValue: (p) => marginPct(p.price, p.cost),
      render: (p) => { const m = marginPct(p.price, p.cost); return <span className={cx('tabular-nums font-medium', m < 10 ? 'text-red-600' : m < 25 ? 'text-amber-600' : 'text-emerald-600')}>{m.toFixed(0)}%</span> },
    },
    { key: 'stock', header: 'Stock', align: 'right', sortValue: (p) => p.stock, render: (p) => <StockPill p={p} /> },
    { key: 'sold', header: 'Sold', align: 'right', sortValue: (p) => p.soldCount, render: (p) => <span className="text-slate-600 tabular-nums">{p.soldCount}</span> },
    {
      key: 'active', header: 'Active', align: 'center', sortValue: (p) => (p.active ? 1 : 0),
      render: (p) => (
        <div onClick={(e) => e.stopPropagation()} className="inline-flex">
          <Toggle checked={p.active} onChange={(v) => { upsertProduct({ id: p.id, active: v }, admin.id); toast.success(`${p.name} ${v ? 'activated' : 'deactivated'}`) }} />
        </div>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (p) => (
        <div onClick={(e) => e.stopPropagation()} className="inline-flex gap-1">
          <button className="btn-ghost !px-2 !py-1" title="Edit" onClick={() => setEditor({ open: true, product: p })}><Pencil size={14} /></button>
        </div>
      ),
    },
  ]

  const chip = (label: string, value: React.ReactNode, icon: React.ReactNode, tone: string, onClick?: () => void, active?: boolean) => (
    <button type="button" onClick={onClick} className={cx('card px-4 py-3 flex items-center gap-3 text-left min-w-0 transition-shadow', onClick && 'hover:shadow-pop', active && 'ring-2 ring-brand-500/40')}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${tone}1a`, color: tone }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
        <div className="text-lg font-bold text-slate-900 leading-tight truncate">{value}</div>
      </div>
    </button>
  )

  return (
    <div>
      <PageHeader
        title="Catalog"
        subtitle={`${db.products.length} products across ${db.categories.length} categories and ${db.brands.length} brands`}
        actions={
          <>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCSV(f); e.target.value = '' }} />
            <button className="btn-secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import CSV</button>
            <button className="btn-secondary" onClick={exportCSV}><Download size={15} /> Export CSV</button>
            <button className="btn-secondary" onClick={() => setCatsOpen(true)}><Tags size={15} /> Categories</button>
            <button className="btn-secondary" onClick={() => setBrandsOpen(true)}><Award size={15} /> Brands</button>
            <button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> New product</button>
          </>
        }
      />

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
        {chip('Products', db.products.length, <Package size={17} />, '#2563eb', () => { setStatus('all'); setStock('all') }, status === 'all' && stock === 'all')}
        {chip('Active', activeCount, <CheckCircle2 size={17} />, '#22c55e', () => { setStatus('active'); setStock('all') }, status === 'active')}
        {chip('Low stock', inv.low, <AlertTriangle size={17} />, '#f59e0b', () => { setStock('low'); setStatus('all') }, stock === 'low')}
        {chip('Out of stock', inv.out, <PackageX size={17} />, '#ef4444', () => { setStock('out'); setStatus('all') }, stock === 'out')}
        {chip('Retail value', money(inv.retail), <CircleDollarSign size={17} />, '#8b5cf6')}
      </div>

      {/* Toolbar */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, SKU, barcode, tag…" className="w-full md:w-72" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-auto min-w-[150px]">
          <option value="">All categories</option>
          {db.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </Select>
        <Select value={brand} onChange={(e) => setBrand(e.target.value)} className="!w-auto min-w-[130px]">
          <option value="">All brands</option>
          {db.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="!w-auto">
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select value={stock} onChange={(e) => setStock(e.target.value as StockFilter)} className="!w-auto">
          <option value="all">Any stock</option>
          <option value="in">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </Select>
        {(q || cat || brand || status !== 'all' || stock !== 'all') && (
          <button className="btn-ghost !px-2" onClick={() => { setQ(''); setCat(''); setBrand(''); setStatus('all'); setStock('all') }}><X size={14} /> Clear</button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-slate-400">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        <Segmented value={view} onChange={setView} options={[{ value: 'table', label: <span className="inline-flex items-center gap-1"><List size={13} /> Table</span> }, { value: 'grid', label: <span className="inline-flex items-center gap-1"><LayoutGrid size={13} /> Grid</span> }]} />
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="card p-3 mb-4 flex flex-wrap items-center gap-2 border-brand-100 bg-brand-50/40 fade-up">
          <Badge tone="blue" className="!text-xs">{selected.size} selected</Badge>
          <span className="text-xs text-slate-500 hidden md:inline">Σ retail {money(selectedProducts.reduce((a, p) => a + p.price * Math.max(0, p.stock), 0))}</span>
          <div className="flex-1" />
          <button className="btn-secondary !py-1.5" onClick={() => bulkActive(true)}><Power size={14} /> Activate</button>
          <button className="btn-secondary !py-1.5" onClick={() => bulkActive(false)}><PowerOff size={14} /> Deactivate</button>
          <button className="btn-secondary !py-1.5" onClick={() => setBulkCat(true)}><FolderInput size={14} /> Change category</button>
          <button className="btn-secondary !py-1.5" onClick={() => setBulkPrice(true)}><Percent size={14} /> Adjust price</button>
          <button className="btn-danger !py-1.5" onClick={bulkDelete}><Trash2 size={14} /> Delete</button>
          <button className="btn-ghost !px-2 !py-1.5" onClick={() => setSelected(new Set())}><X size={14} /></button>
        </div>
      )}

      {view === 'table' ? (
        <div className="card p-3">
          <DataTable
            rows={filtered} columns={columns} pageSize={20} selectable selected={selected} onSelect={setSelected}
            onRowClick={(p) => navigate(`/admin/catalog/${p.id}`)}
            defaultSort={{ key: 'name', dir: 'asc' }}
            rowClassName={(p) => (p.active ? '' : 'opacity-70')}
            empty={<EmptyState icon={<Package size={22} />} title="No products match" description="Try clearing the filters, or add a new product." action={<button className="btn-primary" onClick={() => setEditor({ open: true })}><Plus size={15} /> New product</button>} />}
          />
        </div>
      ) : (
        filtered.length ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            {filtered.map((p) => {
              const s = stockStatus(p)
              const c = catById[p.categoryId]
              const sel = selected.has(p.id)
              return (
                <div key={p.id} onClick={() => navigate(`/admin/catalog/${p.id}`)} className={cx('card p-4 cursor-pointer hover:shadow-pop transition-shadow relative group', sel && 'ring-2 ring-brand-500/50', !p.active && 'opacity-60')}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); const n = new Set(selected); sel ? n.delete(p.id) : n.add(p.id); setSelected(n) }} className={cx('absolute top-3 left-3 w-5 h-5 rounded border flex items-center justify-center transition-opacity', sel ? 'bg-brand-600 border-brand-600 text-white opacity-100' : 'bg-white border-slate-300 opacity-0 group-hover:opacity-100')}>{sel && <Check size={12} strokeWidth={3} />}</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setEditor({ open: true, product: p }) }} className="absolute top-3 right-3 btn-ghost !p-1 opacity-0 group-hover:opacity-100"><Pencil size={13} /></button>
                  <div className="w-full aspect-[4/3] rounded-xl flex items-center justify-center text-5xl mb-3" style={{ background: `${c?.color ?? '#64748b'}12` }}>{p.emoji}</div>
                  <div className="font-medium text-slate-800 text-sm leading-snug line-clamp-2 min-h-[2.5rem]">{p.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">{brandById[p.brandId]?.name} · {p.sku}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-bold text-slate-900">{money(p.price)}</span>
                    {s === 'na' ? <Badge>Service</Badge> : s === 'out' ? <Badge tone="red">Out</Badge> : s === 'low' ? <Badge tone="amber">{p.stock} left</Badge> : <Badge tone="green">{p.stock} in stock</Badge>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : <div className="card"><EmptyState icon={<Package size={22} />} title="No products match" description="Try clearing the filters, or add a new product." /></div>
      )}

      <ProductEditor open={editor.open} product={editor.product} onClose={() => setEditor({ open: false })} />
      <ManageCategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} />
      <ManageBrandsModal open={brandsOpen} onClose={() => setBrandsOpen(false)} />
      <BulkCategoryModal open={bulkCat} onClose={() => setBulkCat(false)} ids={ids} onDone={() => setSelected(new Set())} />
      <BulkPriceModal open={bulkPrice} onClose={() => setBulkPrice(false)} products={selectedProducts} onDone={() => setSelected(new Set())} />
    </div>
  )
}

// ─── Product editor drawer ───────────────────────────────────────────────────
interface FormState {
  name: string; emoji: string; sku: string; barcode: string; categoryId: string; brandId: string; supplierId: string
  price: string; cost: string; taxable: boolean; trackSerial: boolean; lowStockThreshold: string; initialStock: string
  storage: string; color: string; size: string; condition: '' | 'new' | 'refurbished' | 'open-box'; tags: string; description: string; active: boolean
}
export function ProductEditor({ open, onClose, product }: { open: boolean; onClose: () => void; product?: Product }) {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const upsertProduct = useDB((s) => s.upsertProduct)
  const blank = (): FormState => ({
    name: '', emoji: '📱', sku: '', barcode: '', categoryId: db.categories[0]?.id ?? '', brandId: db.brands[0]?.id ?? '', supplierId: '',
    price: '', cost: '', taxable: true, trackSerial: false, lowStockThreshold: String(db.settings.lowStockDefault), initialStock: '0',
    storage: '', color: '', size: '', condition: '', tags: '', description: '', active: true,
  })
  const [f, setF] = useState<FormState>(blank)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!open) return
    if (product) {
      setF({
        name: product.name, emoji: product.emoji, sku: product.sku, barcode: product.barcode, categoryId: product.categoryId, brandId: product.brandId, supplierId: product.supplierId ?? '',
        price: String(product.price), cost: String(product.cost), taxable: product.taxable, trackSerial: product.trackSerial, lowStockThreshold: String(product.lowStockThreshold), initialStock: '0',
        storage: product.attrs.storage ?? '', color: product.attrs.color ?? '', size: product.attrs.size ?? '', condition: product.attrs.condition ?? '', tags: product.tags.join(', '), description: product.description ?? '', active: product.active,
      })
    } else setF(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const price = Number(f.price) || 0
  const cost = Number(f.cost) || 0
  const margin = marginPct(price, cost)
  const isService = f.categoryId === 'cat_service'
  const skuTaken = db.products.some((p) => p.id !== product?.id && f.sku && p.sku.toLowerCase() === f.sku.trim().toLowerCase())
  const barcodeTaken = db.products.some((p) => p.id !== product?.id && f.barcode && p.barcode === f.barcode.trim())

  const save = () => {
    if (!f.name.trim()) { toast.error('Product name is required'); return }
    if (price < 0 || cost < 0) { toast.error('Price and cost must be positive'); return }
    if (skuTaken) { toast.error('That SKU is already used by another product'); return }
    if (barcodeTaken) { toast.error('That barcode is already used by another product'); return }
    setSaving(true)
    const attrs: ProductVariantAttr = {}
    if (f.storage.trim()) attrs.storage = f.storage.trim()
    if (f.color.trim()) attrs.color = f.color.trim()
    if (f.size.trim()) attrs.size = f.size.trim()
    if (f.condition) attrs.condition = f.condition
    const payload: Partial<Product> & { id?: ID } = {
      id: product?.id, name: f.name.trim(), emoji: f.emoji || '📦', sku: f.sku.trim(), barcode: f.barcode.trim(), categoryId: f.categoryId, brandId: f.brandId, supplierId: f.supplierId || undefined,
      price: round2(price), cost: round2(cost), taxable: f.taxable, trackSerial: f.trackSerial, lowStockThreshold: Math.max(0, Math.round(Number(f.lowStockThreshold) || 0)),
      attrs, tags: f.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean), description: f.description.trim() || undefined, active: f.active,
    }
    if (!product) payload.stock = isService ? 999 : Math.max(0, Math.round(Number(f.initialStock) || 0))
    const saved = upsertProduct(payload, admin.id)
    setSaving(false)
    toast.success(product ? `Saved changes to ${saved.name}` : `Created ${saved.name}`)
    onClose()
  }

  return (
    <Drawer open={open} onClose={onClose} title={product ? 'Edit product' : 'New product'} width="max-w-2xl"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving} onClick={save}><Check size={15} /> {product ? 'Save changes' : 'Create product'}</button></>}>
      <div className="space-y-5">
        {/* Identity */}
        <section>
          <div className="flex items-start gap-4">
            <div>
              <span className="label">Image</span>
              <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-4xl">{f.emoji || '📦'}</div>
            </div>
            <div className="flex-1 space-y-3">
              <Field label="Product name" required><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. iPhone 15 Pro 128GB" autoFocus /></Field>
              <div>
                <span className="label">Emoji</span>
                <div className="flex flex-wrap gap-1">
                  {EMOJI_CHOICES.map((e) => (
                    <button key={e} type="button" onClick={() => set('emoji', e)} className={cx('w-8 h-8 rounded-lg text-lg flex items-center justify-center border transition-colors', f.emoji === e ? 'border-brand-500 bg-brand-50' : 'border-transparent hover:bg-slate-100')}>{e}</button>
                  ))}
                  <input value={f.emoji} onChange={(e) => set('emoji', e.target.value.slice(0, 4))} className="input !w-16 text-center text-lg !py-1" placeholder="✨" title="Type any emoji" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="SKU" hint={skuTaken ? 'Already in use' : 'Leave blank to auto-generate'} className={cx(skuTaken && '[&_.input]:border-red-400')}>
            <Input value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder="SKU-1024" className="font-mono" />
          </Field>
          <Field label="Barcode" hint={barcodeTaken ? 'Already in use' : undefined}>
            <div className="flex gap-2">
              <Input value={f.barcode} onChange={(e) => set('barcode', e.target.value.replace(/\D/g, ''))} placeholder="EAN-13" className="font-mono" />
              <button type="button" className="btn-secondary shrink-0" onClick={() => set('barcode', generateBarcode(Math.random))}><Wand2 size={14} /> Generate</button>
            </div>
          </Field>
          <Field label="Category" required>
            <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              {db.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Brand" required>
            <Select value={f.brandId} onChange={(e) => set('brandId', e.target.value)}>
              {db.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Supplier" className="md:col-span-2">
            <Select value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
              <option value="">No supplier</option>
              {db.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </section>

        {/* Pricing */}
        <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Pricing</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label={`Selling price (${db.settings.currency}, ex tax)`} required><Input type="number" min={0} step="0.01" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" /></Field>
            <Field label="Cost price"><Input type="number" min={0} step="0.01" value={f.cost} onChange={(e) => set('cost', e.target.value)} placeholder="0.00" /></Field>
            <div>
              <span className="label">Margin</span>
              <div className={cx('input flex items-center justify-between !bg-white', margin < 10 ? 'text-red-600' : margin < 25 ? 'text-amber-600' : 'text-emerald-600')}>
                <span className="font-semibold">{margin.toFixed(1)}%</span>
                <span className="text-xs text-slate-400">{money(round2(price - cost))} / unit</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-6 mt-3">
            <Toggle checked={f.taxable} onChange={(v) => set('taxable', v)} label={<span>Taxable ({db.settings.taxName} {db.settings.taxRate}%)</span>} />
            <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Active (visible at the register)" />
          </div>
        </section>

        {/* Inventory */}
        <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Inventory</div>
          {isService ? (
            <div className="text-sm text-slate-500">Services are not stock-tracked. Stock is set to 999 automatically.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Low stock threshold" hint="Alerts trigger at or below this"><Input type="number" min={0} value={f.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} /></Field>
              {!product ? (
                <Field label="Initial stock" hint="Creates an 'initial' stock movement"><Input type="number" min={0} value={f.initialStock} onChange={(e) => set('initialStock', e.target.value)} /></Field>
              ) : (
                <div>
                  <span className="label">Current stock</span>
                  <div className="input !bg-white flex items-center justify-between"><span className="font-semibold">{product.stock}</span><span className="text-xs text-slate-400">use Adjust stock to change</span></div>
                </div>
              )}
              <div className="flex items-end pb-2">
                <Toggle checked={f.trackSerial} onChange={(v) => set('trackSerial', v)} label="Track serial / IMEI" />
              </div>
            </div>
          )}
        </section>

        {/* Attributes */}
        <section>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Variant attributes</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Storage"><Input value={f.storage} onChange={(e) => set('storage', e.target.value)} placeholder="128GB" /></Field>
            <Field label="Color"><Input value={f.color} onChange={(e) => set('color', e.target.value)} placeholder="Black" /></Field>
            <Field label="Size"><Input value={f.size} onChange={(e) => set('size', e.target.value)} placeholder="6.1”" /></Field>
            <Field label="Condition">
              <Select value={f.condition} onChange={(e) => set('condition', e.target.value as FormState['condition'])}>
                <option value="">—</option>
                <option value="new">New</option>
                <option value="refurbished">Refurbished</option>
                <option value="open-box">Open box</option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <Field label="Tags" hint="Comma separated, e.g. flagship, 5g, value">
            <Input value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="flagship, 5g" />
          </Field>
          {f.tags.trim() && (
            <div className="flex flex-wrap gap-1 -mt-1">
              {f.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t, i) => <Badge key={i} tone="blue">#{t.toLowerCase()}</Badge>)}
            </div>
          )}
          <Field label="Description"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Shown to staff at the register and on product pages" /></Field>
        </section>
      </div>
    </Drawer>
  )
}

// ─── Manage categories ───────────────────────────────────────────────────────
const SWATCHES = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#ca8a04', '#64748b', '#ef4444']
function ManageCategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const upsertCategory = useDB((s) => s.upsertCategory)
  const deleteCategory = useDB((s) => s.deleteCategory)
  const [editing, setEditing] = useState<{ id?: ID; name: string; color: string; icon: string } | null>(null)
  const counts = useMemo(() => { const m: Record<string, number> = {}; db.products.forEach((p) => { m[p.categoryId] = (m[p.categoryId] ?? 0) + 1 }); return m }, [db.products])
  const sorted = [...db.categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const save = () => {
    if (!editing) return
    if (!editing.name.trim()) { toast.error('Name is required'); return }
    upsertCategory({ id: editing.id, name: editing.name.trim(), color: editing.color, icon: editing.icon || '📦' }, admin.id)
    toast.success(editing.id ? 'Category updated' : 'Category created')
    setEditing(null)
  }
  const remove = async (c: Category) => {
    const n = counts[c.id] ?? 0
    if (!(await confirm(`Delete “${c.name}”?`, n ? `${n} product(s) will be moved to another category.` : 'This category has no products.', { danger: true, confirmLabel: 'Delete' }))) return
    deleteCategory(c.id, admin.id)
    toast.success('Category deleted')
  }
  const form = editing && (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3 grid grid-cols-[64px_1fr] gap-3 items-start fade-up">
      <Field label="Icon"><Input value={editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value.slice(0, 4) })} className="text-center text-lg" /></Field>
      <div className="space-y-2">
        <Field label="Name"><Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="Category name" /></Field>
        <div>
          <span className="label">Color</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SWATCHES.map((c) => <button key={c} type="button" onClick={() => setEditing({ ...editing, color: c })} className={cx('w-6 h-6 rounded-full border-2', editing.color === c ? 'border-slate-800' : 'border-transparent')} style={{ background: c }} />)}
            <input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="w-8 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button className="btn-primary !py-1.5" onClick={save}><Check size={14} /> Save</button>
          <button className="btn-ghost !py-1.5" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    </div>
  )
  return (
    <Modal open={open} onClose={onClose} title="Manage categories" subtitle="Categories group products at the register and in reports" footer={<button className="btn-secondary" onClick={onClose}>Done</button>}>
      <div className="space-y-2 pb-2">
        {!editing && <button className="btn-secondary w-full justify-center" onClick={() => setEditing({ name: '', color: SWATCHES[0]!, icon: '📦' })}><Plus size={14} /> Add category</button>}
        {editing && !editing.id && form}
        {sorted.map((c) => (
          <div key={c.id}>
            {editing?.id === c.id ? form : (
              <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: `${c.color}1a` }}>{c.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate">{c.name}</div>
                  <div className="text-xs text-slate-400">{counts[c.id] ?? 0} product{(counts[c.id] ?? 0) === 1 ? '' : 's'}{c.id === 'cat_service' ? ' · not stock-tracked' : ''}</div>
                </div>
                <span className="w-3 h-3 rounded-full" style={{ background: c.color }} />
                <button className="btn-ghost !px-2 !py-1" onClick={() => setEditing({ id: c.id, name: c.name, color: c.color, icon: c.icon })}><Pencil size={14} /></button>
                <button className="btn-ghost !px-2 !py-1 text-red-600 hover:bg-red-50" disabled={db.categories.length <= 1} onClick={() => remove(c)}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

function ManageBrandsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB((s) => s.db)
  const admin = useAdminUser()!
  const upsertBrand = useDB((s) => s.upsertBrand)
  const deleteBrand = useDB((s) => s.deleteBrand)
  const [editing, setEditing] = useState<{ id?: ID; name: string } | null>(null)
  const counts = useMemo(() => { const m: Record<string, number> = {}; db.products.forEach((p) => { m[p.brandId] = (m[p.brandId] ?? 0) + 1 }); return m }, [db.products])
  const save = () => {
    if (!editing) return
    if (!editing.name.trim()) { toast.error('Name is required'); return }
    if (db.brands.some((b) => b.id !== editing.id && b.name.toLowerCase() === editing.name.trim().toLowerCase())) { toast.error('A brand with that name already exists'); return }
    upsertBrand({ id: editing.id, name: editing.name.trim() }, admin.id)
    toast.success(editing.id ? 'Brand updated' : 'Brand created')
    setEditing(null)
  }
  const remove = async (b: Brand) => {
    const n = counts[b.id] ?? 0
    if (!(await confirm(`Delete “${b.name}”?`, n ? `${n} product(s) will be moved to another brand.` : 'This brand has no products.', { danger: true, confirmLabel: 'Delete' }))) return
    deleteBrand(b.id, admin.id)
    toast.success('Brand deleted')
  }
  const form = editing && (
    <div className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/40 p-2 fade-up">
      <Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="Brand name" />
      <button className="btn-primary !py-1.5" onClick={save}><Check size={14} /></button>
      <button className="btn-ghost !py-1.5 !px-2" onClick={() => setEditing(null)}><X size={14} /></button>
    </div>
  )
  return (
    <Modal open={open} onClose={onClose} title="Manage brands" size="sm" footer={<button className="btn-secondary" onClick={onClose}>Done</button>}>
      <div className="space-y-2 pb-2">
        {!editing && <button className="btn-secondary w-full justify-center" onClick={() => setEditing({ name: '' })}><Plus size={14} /> Add brand</button>}
        {editing && !editing.id && form}
        {[...db.brands].sort((a, b) => a.name.localeCompare(b.name)).map((b) => (
          <div key={b.id}>
            {editing?.id === b.id ? form : (
              <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold">{b.name.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate">{b.name}</div>
                  <div className="text-xs text-slate-400">{counts[b.id] ?? 0} product{(counts[b.id] ?? 0) === 1 ? '' : 's'}</div>
                </div>
                <button className="btn-ghost !px-2 !py-1" onClick={() => setEditing({ id: b.id, name: b.name })}><Pencil size={14} /></button>
                <button className="btn-ghost !px-2 !py-1 text-red-600 hover:bg-red-50" disabled={db.brands.length <= 1} onClick={() => remove(b)}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ─── Bulk modals ─────────────────────────────────────────────────────────────
function BulkCategoryModal({ open, onClose, ids, onDone }: { open: boolean; onClose: () => void; ids: ID[]; onDone: () => void }) {
  const categories = useDB((s) => s.db.categories)
  const admin = useAdminUser()!
  const bulkUpdateProducts = useDB((s) => s.bulkUpdateProducts)
  const [cat, setCat] = useState('')
  useEffect(() => { if (open) setCat(categories[0]?.id ?? '') }, [open, categories])
  return (
    <Modal open={open} onClose={onClose} title="Change category" subtitle={`${ids.length} product(s) selected`} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => { bulkUpdateProducts(ids, { categoryId: cat }, admin.id); toast.success(`Moved ${ids.length} product(s)`); onDone(); onClose() }}>Apply</button></>}>
      <Field label="New category">
        <Select value={cat} onChange={(e) => setCat(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </Select>
      </Field>
    </Modal>
  )
}

function BulkPriceModal({ open, onClose, products, onDone }: { open: boolean; onClose: () => void; products: Product[]; onDone: () => void }) {
  const admin = useAdminUser()!
  const upsertProduct = useDB((s) => s.upsertProduct)
  const [mode, setMode] = useState<'percent' | 'fixed' | 'set'>('percent')
  const [value, setValue] = useState('')
  const [roundTo, setRoundTo] = useState<'none' | '0.99' | '1'>('none')
  useEffect(() => { if (open) { setMode('percent'); setValue(''); setRoundTo('none') } }, [open])
  const v = Number(value) || 0
  const calc = (p: number) => {
    let n = mode === 'percent' ? p * (1 + v / 100) : mode === 'fixed' ? p + v : v
    n = Math.max(0, n)
    if (roundTo === '0.99') n = Math.max(0.99, Math.floor(n) + 0.99)
    if (roundTo === '1') n = Math.round(n)
    return round2(n)
  }
  const preview = products.slice(0, 5)
  return (
    <Modal open={open} onClose={onClose} title="Adjust prices" subtitle={`${products.length} product(s) selected`} size="md"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!value} onClick={() => { products.forEach((p) => { const np = calc(p.price); if (np !== p.price) upsertProduct({ id: p.id, price: np }, admin.id) }); toast.success(`Updated prices on ${products.length} product(s)`); onDone(); onClose() }}>Apply to {products.length}</button></>}>
      <div className="space-y-3 pb-2">
        <Segmented value={mode} onChange={setMode} size="md" options={[{ value: 'percent', label: 'Change by %' }, { value: 'fixed', label: 'Change by amount' }, { value: 'set', label: 'Set price' }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={mode === 'percent' ? 'Percent (negative to reduce)' : mode === 'fixed' ? 'Amount (negative to reduce)' : 'New price'}>
            <Input type="number" step="0.01" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'percent' ? '-10' : '0.00'} />
          </Field>
          <Field label="Rounding">
            <Select value={roundTo} onChange={(e) => setRoundTo(e.target.value as typeof roundTo)}>
              <option value="none">No rounding</option>
              <option value="0.99">End in .99</option>
              <option value="1">Whole number</option>
            </Select>
          </Field>
        </div>
        <div className="rounded-xl border border-slate-100 overflow-hidden">
          <table className="table">
            <thead><tr><th>Preview</th><th className="text-right">Current</th><th className="text-right">New</th><th className="text-right">Margin</th></tr></thead>
            <tbody>
              {preview.map((p) => { const np = calc(p.price); return (
                <tr key={p.id}>
                  <td className="truncate max-w-[200px]">{p.emoji} {p.name}</td>
                  <td className="text-right text-slate-500 tabular-nums">{money(p.price)}</td>
                  <td className={cx('text-right font-semibold tabular-nums', np > p.price ? 'text-emerald-600' : np < p.price ? 'text-red-600' : '')}>{money(np)}</td>
                  <td className="text-right tabular-nums text-slate-500">{marginPct(np, p.cost).toFixed(0)}%</td>
                </tr>
              ) })}
            </tbody>
          </table>
          {products.length > preview.length && <div className="text-xs text-slate-400 px-3 py-2">…and {products.length - preview.length} more</div>}
        </div>
      </div>
    </Modal>
  )
}

