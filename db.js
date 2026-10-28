// Data layer abstraction.
// - If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (Vercel/cloud),
//   data is stored in Upstash Redis (free tier, no credit card required).
// - Otherwise, falls back to a local JSON file (for local development).
const fs = require('fs');
const path = require('path');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

const DB_FILE = path.join(__dirname, 'data.json');
let fileDb = null;

function initFileDb() {
  if (fileDb) return;
  try {
    fileDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    fileDb = { users: [], data: {} };
  }
}

function saveFileDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2));
  } catch (e) {
    console.error('DB save error:', e);
  }
}

async function upstash(method, key, value) {
  const url = `${UPSTASH_URL}/${method}/${encodeURIComponent(key)}`;
  const isWrite = (method === 'set');
  const opts = {
    method: isWrite ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  };
  if (isWrite && value !== undefined) {
    // Upstash REST: value passed as the raw request body for POST
    opts.body = value;
  }
  try {
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Upstash error:', method, res.status, json);
    }
    return json;
  } catch (e) {
    console.error('Upstash fetch error:', e);
    return {};
  }
}

// ===== Users =====
async function getUsers() {
  if (USE_UPSTASH) {
    const r = await upstash('get', 'users');
    return r.result ? JSON.parse(r.result) : [];
  }
  initFileDb();
  return fileDb.users;
}

async function saveUsers(users) {
  if (USE_UPSTASH) {
    await upstash('set', 'users', JSON.stringify(users));
    return;
  }
  initFileDb();
  fileDb.users = users;
  saveFileDb();
}

// ===== Per-user data =====
async function getUserData(userId) {
  if (USE_UPSTASH) {
    const r = await upstash('get', `data:${userId}`);
    return r.result ? JSON.parse(r.result) : null;
  }
  initFileDb();
  return fileDb.data[userId] || null;
}

async function saveUserData(userId, payload) {
  if (USE_UPSTASH) {
    await upstash('set', `data:${userId}`, JSON.stringify(payload));
    return;
  }
  initFileDb();
  fileDb.data[userId] = payload;
  saveFileDb();
}

async function healthInfo() {
  if (USE_UPSTASH) {
    const users = await getUsers();
    return { storage: 'upstash', users: users.length };
  }
  initFileDb();
  return { storage: 'file', users: fileDb.users.length, dataKeys: Object.keys(fileDb.data).length };
}

module.exports = {
  USE_UPSTASH,
  getUsers,
  saveUsers,
  getUserData,
  saveUserData,
  healthInfo,
};
