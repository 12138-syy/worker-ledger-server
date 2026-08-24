const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'worker-ledger-2026-cloud-sync';

// ===== JSON file database =====
const DB_FILE = path.join(__dirname, 'data.json');
let db = { users: [], data: {} };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) {
  // first run - empty db
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('DB save error:', e);
  }
}

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Serve static from root (for cloud deploy) and public/ (for local dev)
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// ===== Auth middleware =====
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// ===== API Routes =====

// Register
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码不能为空' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });

  const existing = db.users.find(u => u.email === email);
  if (existing) return res.status(409).json({ error: '该邮箱已注册' });

  const hashed = bcrypt.hashSync(password, 10);
  const userId = 'u' + Date.now() + Math.random().toString(36).slice(2, 6);
  db.users.push({ id: userId, email, password: hashed, createdAt: new Date().toISOString() });
  saveDb();

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, userId, email });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码不能为空' });

  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: '邮箱或密码错误' });

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, userId: user.id, email });
});

// Verify token (check if still valid)
app.get('/api/verify', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  res.json({ valid: true, userId: req.userId, email: user?.email || '' });
});

// Get user data
app.get('/api/data', auth, (req, res) => {
  const userData = db.data[req.userId];
  res.json({ data: userData?.data || null, updatedAt: userData?.updatedAt || null });
});

// Save user data
app.post('/api/data', auth, (req, res) => {
  const { data } = req.body;
  if (data === undefined) return res.status(400).json({ error: '缺少数据' });

  db.data[req.userId] = {
    data,
    updatedAt: new Date().toISOString(),
  };
  saveDb();
  res.json({ success: true, updatedAt: db.data[req.userId].updatedAt });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', users: db.users.length, dataKeys: Object.keys(db.data).length });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Worker Ledger Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
