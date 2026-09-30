# Phone man POS

A complete point-of-sale demo for a phone store, built as a static web app you can deploy to Netlify in one click.

It ships three workspaces that share one live data store:

| Workspace | URL | Purpose |
| --- | --- | --- |
| Admin Console | `/admin` | Dashboard, sales analytics, transactions, catalog, inventory, purchase orders, suppliers, promotions, customers, repairs, staff, registers & shifts, activity log, reports, settings |
| Cashier Portal | `/cashier` | PIN login per cashier, register selection, shift open/close, selling screen with barcode/IMEI scanning, cart, discounts, payments, refunds, holds, cash drawer |
| Customer Display | `/display/:registerId` | Second screen facing the customer: scanned items, running total, payment status, thank-you screen |

Open the three screens in separate browser tabs or windows. Every change made in one is reflected in the others instantly (cross-tab sync).

## Demo accounts

| Role | Login |
| --- | --- |
| Admin | `admin@phoneman.store` / `admin123` (PIN `0000`) |
| Manager | `priya@phoneman.store` / `manager123` (PIN `9999`) |
| Cashier 1 | PIN `1111` (Jordan Lee) |
| Cashier 2 | PIN `2222` (Sam Rivera) |
| Cashier 3 | PIN `3333` (Taylor Brooks) |

## Running locally

```bash
npm install
npm run dev
```

## Deploying to Netlify

The repo contains `netlify.toml` and `public/_redirects`, so all you need is:

1. Push this repository to GitHub.
2. In Netlify choose **Add new site → Import an existing project** and pick the repo.
3. Build command `npm run build`, publish directory `dist` (already set in `netlify.toml`).

## How data works

There is no backend. The whole database (catalog, customers, 120 days of transactions, shifts, stock movements, audit log…) is generated on first load and stored in the browser's `localStorage`. It syncs between tabs of the same browser using `BroadcastChannel`.

- **Reset demo data**: Admin → Settings → Data → Reset.
- **Export / import**: Admin → Settings → Data. The export is a single JSON file you can re-import on another machine.

Because data is per browser, two different computers will not see each other's sales. Wiring the same store to a hosted database (Supabase, Firebase, or a small API) is the next step to make it multi-device.

## Tech

Vite · React 18 · TypeScript · Tailwind CSS · Zustand + Immer · Recharts · Lucide icons · date-fns
