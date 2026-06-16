// CPHI Sponsorship Platform — Smartsheet proxy + PDF host
// Node 18+ (uses global fetch). Deploy on Render/Fly/Railway.
// Env: SMARTSHEET_TOKEN=<your Smartsheet API token>
//
// Endpoints:
//   GET  /api/sheets                       → list sheets (to discover SHEET_ID)
//   GET  /api/products/:sheetId            → rows keyed by column name (+ _rowId)
//   POST /api/hold/:sheetId/:rowId         → soft-hold write-back {column,status}
//   GET  /pdfs/<file>.pdf                  → hosted show PDFs (put files in ./pdfs)

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const TOKEN = process.env.SMARTSHEET_TOKEN;
const SS = 'https://api.smartsheet.com/2.0';
const auth = () => ({ Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' });

app.use(cors());                 // tighten to your host in production: cors({ origin: 'https://your-host' })
app.use(express.json());

// Serve the official show PDFs (drop files into ./pdfs). These give you the
// public, CORS-enabled URLs the front-end SHOW_PDF config points at, e.g.
//   https://your-proxy.onrender.com/pdfs/cphi-milan-2026.pdf
app.use('/pdfs', express.static(path.join(__dirname, 'pdfs'), {
  setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*'),
}));

// Serve the contract template PDF for browser-side AcroForm filling
const CONTRACT_PDF = process.env.CONTRACT_PDF || 'C:/Users/Jared/Downloads/Sponsorship contract v1 (1).pdf';
const fs = require('fs');
app.get('/api/contract', (req, res) => {
  try {
    const buf = fs.readFileSync(CONTRACT_PDF);
    res.set({ 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public,max-age=3600' });
    res.send(buf);
  } catch (e) {
    res.status(404).json({ error: `Contract PDF not found at ${CONTRACT_PDF}` });
  }
});

function needToken(res) {
  if (!TOKEN) { res.status(500).json({ error: 'SMARTSHEET_TOKEN not set' }); return true; }
  return false;
}

// List sheets
app.get('/api/sheets', async (req, res) => {
  if (needToken(res)) return;
  try {
    const r = await fetch(`${SS}/sheets`, { headers: auth() });
    const j = await r.json();
    res.json({ sheets: (j.data || []).map(s => ({ id: s.id, name: s.name })) });
  } catch (e) { res.status(502).json({ error: String(e) }); }
});

// Products — flatten rows to objects keyed by column name, include _rowId
app.get('/api/products/:sheetId', async (req, res) => {
  if (needToken(res)) return;
  try {
    const r = await fetch(`${SS}/sheets/${req.params.sheetId}`, { headers: auth() });
    if (!r.ok) return res.status(r.status).json({ error: `Smartsheet ${r.status}` });
    const sheet = await r.json();
    const colById = {}; sheet.columns.forEach(c => { colById[c.id] = c.title; });
    const products = (sheet.rows || []).map(row => {
      const o = { _rowId: row.id };
      row.cells.forEach(c => { if (c.columnId in colById) o[colById[c.columnId]] = c.displayValue ?? c.value ?? ''; });
      return o;
    });
    res.json({ columns: sheet.columns.map(c => c.title), products });
  } catch (e) { res.status(502).json({ error: String(e) }); }
});

// Soft hold — check-then-set + write client details + add IO comment
app.post('/api/hold/:sheetId/:rowId', async (req, res) => {
  if (needToken(res)) return;
  const {
    column = 'Status (Hold or Sold)',
    status = 'On Hold',
    fields = {},   // { 'Company Name': 'Pfizer', 'Contact Name': 'Jane', ... }
    comment = '',  // IO reference added as a row comment
  } = req.body || {};
  const { sheetId, rowId } = req.params;
  try {
    // 1. Fetch columns only (lightweight — avoids loading all 700+ rows)
    const cr = await fetch(`${SS}/sheets/${sheetId}/columns`, { headers: auth() });
    if (!cr.ok) return res.status(cr.status).json({ ok: false, error: `Could not fetch columns (${cr.status})` });
    const colData = await cr.json();
    const colByName = {};
    (colData.data || []).forEach(c => { colByName[c.title] = c.id; });

    const statusColId = colByName[column];
    if (!statusColId) return res.status(400).json({ ok: false, error: `Column "${column}" not found. Available: ${Object.keys(colByName).join(', ')}` });

    // 2. Check-then-set: fetch just this one row to get current status
    if (status === 'On Hold') {
      const rr = await fetch(`${SS}/sheets/${sheetId}/rows/${rowId}`, { headers: auth() });
      if (rr.ok) {
        const row = await rr.json();
        const cell = (row.cells || []).find(c => c.columnId === statusColId);
        const current = (cell?.displayValue || cell?.value || '').toLowerCase();
        const taken = current.includes('hold') || current.includes('sold') ||
                      current.includes('completed') || current.includes('not possible');
        if (taken) return res.json({ ok: false, conflict: true, currentStatus: cell?.displayValue || cell?.value || '' });
      }
    }

    // 3. Build cells array — status column + any extra fields
    // Pass value:null to clear a cell, value:'' to clear text cells
    const cells = [{ columnId: statusColId, value: status === '' ? null : status }];
    Object.entries(fields).forEach(([name, value]) => {
      if (colByName[name] !== undefined) {
        // null clears the cell; '' clears text; skip only if key not in colByName
        cells.push({ columnId: colByName[name], value: value === '' ? null : value });
      }
    });

    const r = await fetch(`${SS}/sheets/${sheetId}/rows`, {
      method: 'PUT', headers: auth(),
      body: JSON.stringify([{ id: Number(rowId), cells }]),
    });
    const result = await r.json();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: result.message || 'Write failed' });

    // 4. Add IO reference as a row comment (if provided)
    if (comment) {
      await fetch(`${SS}/sheets/${sheetId}/rows/${rowId}/discussions`, {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ comment: { text: comment } }),
      }).catch(e => console.warn('Comment failed:', e.message));
    }

    res.json({ ok: true });
  } catch (e) { res.status(502).json({ ok: false, error: String(e) }); }
});

app.get('/', (_req, res) => res.send('CPHI proxy running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CPHI proxy on :${PORT}`));
