const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'worker-ledger-2026-cloud-sync';

function createApp() {
  const app = express();

  // ===== Middleware =====
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname)));
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
  app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '邮箱和密码不能为空' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });

    const users = await db.getUsers();
    if (users.find(u => u.email === email)) return res.status(409).json({ error: '该邮箱已注册' });

    const hashed = bcrypt.hashSync(password, 10);
    const userId = 'u' + Date.now() + Math.random().toString(36).slice(2, 6);
    users.push({ id: userId, email, password: hashed, createdAt: new Date().toISOString() });
    await db.saveUsers(users);

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, userId, email });
  });

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '邮箱和密码不能为空' });

    const users = await db.getUsers();
    const user = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: '邮箱或密码错误' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '邮箱或密码错误' });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, userId: user.id, email });
  });

  app.get('/api/verify', auth, async (req, res) => {
    const users = await db.getUsers();
    const user = users.find(u => u.id === req.userId);
    res.json({ valid: true, userId: req.userId, email: user?.email || '' });
  });

  app.get('/api/data', auth, async (req, res) => {
    const userData = await db.getUserData(req.userId);
    res.json({ data: userData?.data || null, updatedAt: userData?.updatedAt || null });
  });

  app.post('/api/data', auth, async (req, res) => {
    const { data } = req.body;
    if (data === undefined) return res.status(400).json({ error: '缺少数据' });
    await db.saveUserData(req.userId, { data, updatedAt: new Date().toISOString() });
    res.json({ success: true, updatedAt: new Date().toISOString() });
  });

  app.get('/api/health', async (req, res) => {
    const info = await db.healthInfo();
    res.json({ status: 'ok', ...info });
  });

  // SPA fallback for non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  // 404 handler for unmatched API routes
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found', path: req.path });
    }
    res.status(404).send('Not found');
  });

  // Error handler: return JSON so Vercel logs show the real message
  app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      path: req.path,
    });
  });

  return app;
}

module.exports = { createApp };
