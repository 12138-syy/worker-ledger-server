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

  // ===== Forgot password (email verification code) =====
  const nodemailer = require('nodemailer');

  function getMailer() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return null;
    return nodemailer.createTransport({
      host, port: Number(port), secure: Number(port) === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
  }

  function resetCodeKey(email) { return `pwd-reset:${email.toLowerCase().trim()}`; }

  app.post('/api/forgot-password-send-code', async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: '请输入有效的邮箱' });

    const users = await db.getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(404).json({ error: '该邮箱未注册' });

    const transport = getMailer();
    if (!transport) return res.status(503).json({ error: '邮件服务未配置，请联系管理员设置 SMTP' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await db.setCode(resetCodeKey(email), code, 600);

    try {
      await transport.sendMail({
        from: `"打工人小账本" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: email,
        subject: '【打工人小账本】密码重置验证码',
        text: `你的密码重置验证码是：${code}，10 分钟内有效。如非本人操作，请忽略。`,
        html: `<p>你的密码重置验证码是：<strong style="font-size:18px">${code}</strong></p><p>10 分钟内有效。如非本人操作，请忽略。</p>`
      });
      res.json({ sent: true });
    } catch (e) {
      console.error('Send mail error:', e);
      res.status(500).json({ error: '验证码邮件发送失败，请稍后重试' });
    }
  });

  app.post('/api/forgot-password-reset', async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: '缺少参数' });
    if (newPassword.length < 6) return res.status(400).json({ error: '密码至少6位' });

    const saved = await db.getCode(resetCodeKey(email));
    if (!saved || saved !== String(code).trim()) return res.status(400).json({ error: '验证码错误或已过期' });

    const users = await db.getUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return res.status(404).json({ error: '该邮箱未注册' });

    users[idx].password = bcrypt.hashSync(newPassword, 10);
    await db.saveUsers(users);
    await db.deleteCode(resetCodeKey(email));

    res.json({ success: true });
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
