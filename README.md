# CPHI Sponsorship Platform

Sponsorship sales tool for CPHI events. Single-file front-end (`cphi-sponsorship.html`) backed by a lightweight Node.js proxy that bridges Smartsheet and the browser.

## What it does

- **Live inventory** — reads product rows from Smartsheet every 60 seconds; groups them by product category with availability indicators
- **Package builder** — drag-and-drop cart with discount tiers, proposal PDF generation
- **Insertion Order** — fills the official CPHI contract PDF (AcroForm) with client details, order items, and totals; ready for e-signature via DocSeal
- **Soft-hold** — locks slots in Smartsheet at IO generation time (not on browsing), with check-then-set race protection; writes company name, contact, email, date to the row

## Quick start

```bash
cd cphi-proxy
npm install
# Windows PowerShell:
$env:SMARTSHEET_TOKEN="your_smartsheet_token"
$env:CONTRACT_PDF="C:/path/to/Sponsorship contract v1 (1).pdf"
npm start
```

Open `cphi-sponsorship.html` in a browser. On first load, click the plug icon (top-right) and set:
- **Proxy URL**: `http://localhost:3000`
- **Digital 2025 Sheet ID**: your Smartsheet sheet ID (get it from `GET /api/sheets`)

## Proxy endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sheets` | List all sheets (use to find sheet IDs) |
| GET | `/api/products/:sheetId` | Rows as objects keyed by column name |
| POST | `/api/hold/:sheetId/:rowId` | Write hold/release back to Smartsheet |
| GET | `/api/contract` | Serve the contract PDF template |
| GET | `/pdfs/<file>.pdf` | Host official show PDFs (drop files in `./pdfs/`) |

## Deploy on Render (free tier)

1. Push this repo to GitHub
2. Render → New Web Service → select repo
3. Build: `npm install` · Start: `node server.js`
4. Add environment variables:
   - `SMARTSHEET_TOKEN` — your Smartsheet API token
   - `CONTRACT_PDF` — path to the contract PDF (or pre-load it into the repo root and set to `./contract.pdf`)

After deploy you get a URL like `https://cphi-proxy.onrender.com` — paste that into the app's connection settings.

## E-signature

After downloading the filled contract PDF, upload to [DocSeal](https://app.docseal.com) (free, unlimited) to add signature fields and send to the client for countersigning.

## Column mapping (Smartsheet)

The proxy expects these column names in your sheet:

| App field | Smartsheet column |
|-----------|-------------------|
| Product name | `Event Product Name` |
| Category / grouping | `Product Class Description` |
| Price | `Product Price` |
| Hold status | `Status (Hold or Sold)` |
| Event code | `Event Code` |
| Company name | `Company Name` |
| Contact name | `Contact Name` |
| Email | `Customer E-mail Address` |
| Hold date | `Sold Date/Hold Date (Please change accordingly)` |
