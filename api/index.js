/**
 * Vercel Serverless entry — ใช้ logic เดียวกับ server.js
 * ตั้ง Environment Variables บน Vercel:
 *   DATABASE_URL, JWT_SECRET, ALLOWED_ORIGINS
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES = '12h';

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL');
}
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('Missing or short JWT_SECRET');
}

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!allowedOrigins.length || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '100kb' }));

// รองรับ path ทั้งแบบ /api/... และกรณี rewrite
app.use((req, _res, next) => {
  // บางสภาพแวดล้อม Vercel ส่ง url มาไม่ครบ
  if (req.url && !req.url.startsWith('/api') && req.originalUrl && req.originalUrl.startsWith('/api')) {
    req.url = req.originalUrl;
  }
  next();
});

// Vercel: rate-limit ใช้ memory ต่อ instance (พอใช้)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ลองเข้าสู่ระบบบ่อยเกินไป รอ 15 นาที' }
});

function thaiNow() {
  const now = new Date();
  return {
    now,
    date: now.toLocaleDateString('th-TH'),
    time: now.toLocaleTimeString('th-TH', { hour12: false }),
    iso: now.toISOString()
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.username,
      role: user.role,
      isAdmin: !!user.isAdmin,
      canViewMonitoring: !!user.canViewMonitoring
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อน' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'โทเคนหมดอายุหรือไม่ถูกต้อง' });
  }
}

function monitoringRequired(req, res, next) {
  if (!req.user?.canViewMonitoring && !req.user?.isAdmin) {
    return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
  }
  next();
}

function safeError(res, err, status = 500) {
  console.error(err);
  res.status(status).json({ error: status === 500 ? 'เกิดข้อผิดพลาดภายใน' : (err.message || 'error') });
}


function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

async function isBanned({ fingerprint, ip }) {
  if (!sql) return null;
  const rows = await sql`
    SELECT id, reason, fingerprint, ip_address, username
    FROM security_bans
    WHERE active = true
      AND (
        (${fingerprint || null}::text IS NOT NULL AND fingerprint = ${fingerprint || null})
        OR (${ip || null}::text IS NOT NULL AND ip_address = ${ip || null})
      )
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function logSecurityEvent({ eventType, username, fingerprint, ip, detail }) {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO security_events (event_type, username, fingerprint, ip_address, detail)
      VALUES (${eventType}, ${username || null}, ${fingerprint || null}, ${ip || null}, ${detail || null})
    `;
  } catch (e) {
    console.error('logSecurityEvent', e);
  }
}

function needDb(res) {
  if (!sql) {
    res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า DATABASE_URL' });
    return false;
  }
  return true;
}

// ---------- Auth ----------
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!JWT_SECRET || JWT_SECRET.length < 16) {
      return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า JWT_SECRET' });
    }
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    const uname = String(username).trim().toLowerCase();
    const rows = await sql`
      SELECT username, password_hash, display_name AS name, role, avatar,
             is_admin AS "isAdmin", can_view_monitoring AS "canViewMonitoring",
             description AS desc
      FROM users WHERE username = ${uname}
    `;
    if (!rows.length) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    const u = rows[0];
    let ok = false;
    if (u.password_hash && u.password_hash.startsWith('$2')) {
      ok = await bcrypt.compare(password, u.password_hash);
    } else {
      ok = u.password_hash === password;
      if (ok) {
        const hashed = await bcrypt.hash(password, 10);
        await sql`UPDATE users SET password_hash = ${hashed} WHERE username = ${uname}`;
      }
    }
    if (!ok) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const fp = (req.body || {}).fingerprint || null;
    const ipLogin = clientIp(req);
    const banHit = await isBanned({ fingerprint: fp, ip: ipLogin });
    if (banHit) {
      await logSecurityEvent({ eventType: 'blocked_login', username: uname, fingerprint: fp, ip: ipLogin, detail: banHit.reason });
      return res.status(403).json({ error: banHit.reason || 'บัญชีหรืออุปกรณ์นี้ถูกระงับการใช้งาน', banned: true });
    }

    const profile = {
      name: u.name, role: u.role, avatar: u.avatar,
      isAdmin: u.isAdmin, canViewMonitoring: u.canViewMonitoring, desc: u.desc
    };
    const token = signToken({
      username: u.username, role: u.role,
      isAdmin: u.isAdmin, canViewMonitoring: u.canViewMonitoring
    });
    res.json({ username: u.username, profile, token });
  } catch (err) {
    safeError(res, err);
  }
});

app.get('/api/me', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const rows = await sql`
      SELECT username, display_name AS name, role, avatar,
             is_admin AS "isAdmin", can_view_monitoring AS "canViewMonitoring",
             description AS desc
      FROM users WHERE username = ${req.user.sub}
    `;
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const u = rows[0];
    res.json({
      username: u.username,
      profile: {
        name: u.name, role: u.role, avatar: u.avatar,
        isAdmin: u.isAdmin, canViewMonitoring: u.canViewMonitoring, desc: u.desc
      }
    });
  } catch (err) {
    safeError(res, err);
  }
});

app.get('/api/users', authRequired, async (_req, res) => {
  try {
    if (!needDb(res)) return;
    const rows = await sql`
      SELECT username, display_name AS name, role, avatar,
             is_admin AS "isAdmin", can_view_monitoring AS "canViewMonitoring",
             description AS desc
      FROM users ORDER BY username
    `;
    const map = {};
    rows.forEach((r) => {
      map[r.username] = {
        name: r.name, role: r.role, avatar: r.avatar,
        isAdmin: r.isAdmin, canViewMonitoring: r.canViewMonitoring, desc: r.desc
      };
    });
    res.json(map);
  } catch (err) {
    safeError(res, err);
  }
});

// ---------- Shifts ----------
app.get('/api/shifts', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { username } = req.query;
    const canSeeAll = req.user.canViewMonitoring || req.user.isAdmin;
    let target = username;
    if (!canSeeAll) target = req.user.sub;

    let rows;
    if (target) {
      rows = await sql`
        SELECT id, username, type, datetime, date_th AS date, time_th AS time,
               duration, is_forced AS "isForced"
        FROM shift_logs WHERE username = ${target}
        ORDER BY created_at DESC LIMIT 500
      `;
    } else {
      rows = await sql`
        SELECT id, username, type, datetime, date_th AS date, time_th AS time,
               duration, is_forced AS "isForced"
        FROM shift_logs ORDER BY created_at DESC LIMIT 2000
      `;
    }
    const log = {};
    for (const r of rows) {
      if (!log[r.username]) log[r.username] = [];
      log[r.username].push({
        id: r.id, type: r.type, datetime: r.datetime,
        date: r.date, time: r.time, duration: r.duration, isForced: r.isForced
      });
    }
    res.json(log);
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/shift-checkin', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const username = req.user.sub;
    const t = thaiNow();
    const open = await sql`
      SELECT id FROM shift_logs
      WHERE username = ${username} AND type = 'เข้าเวร'
        AND duration IS NULL AND date_th = ${t.date}
      LIMIT 1
    `;
    if (open.length) return res.status(400).json({ error: 'เข้าเวรอยู่แล้ว' });
    const inserted = await sql`
      INSERT INTO shift_logs (username, type, datetime, date_th, time_th)
      VALUES (${username}, 'เข้าเวร', ${t.iso}, ${t.date}, ${t.time})
      RETURNING id, username, type, datetime, date_th AS date, time_th AS time
    `;
    res.json(inserted[0]);
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/shift-checkout', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { isForced = false, username: targetUser } = req.body || {};
    let username = req.user.sub;
    if (isForced && targetUser && targetUser !== req.user.sub) {
      if (!req.user.canViewMonitoring && !req.user.isAdmin) {
        return res.status(403).json({ error: 'ไม่มีสิทธิ์บังคับออกเวร' });
      }
      username = targetUser;
    }
    const t = thaiNow();
    const openRows = await sql`
      SELECT id, datetime FROM shift_logs
      WHERE username = ${username} AND type = 'เข้าเวร'
        AND duration IS NULL AND date_th = ${t.date}
      ORDER BY created_at DESC LIMIT 1
    `;
    if (!openRows.length) return res.status(400).json({ error: 'ไม่พบเวรที่ค้างอยู่' });
    const open = openRows[0];
    const diffMin = Math.max(0, Math.floor((t.now - new Date(open.datetime)) / 60000));
    const hours = Math.floor(diffMin / 60);
    const minutes = diffMin % 60;
    const duration = hours > 0 ? `${hours} ชม. ${minutes} นาที` : `${minutes} นาที`;
    await sql`UPDATE shift_logs SET duration = ${duration} WHERE id = ${open.id}`;
    const inserted = await sql`
      INSERT INTO shift_logs (username, type, date_th, time_th, duration, is_forced)
      VALUES (${username}, 'ออกเวร', ${t.date}, ${t.time}, ${duration}, ${!!isForced})
      RETURNING id, username, type, date_th AS date, time_th AS time, duration, is_forced AS "isForced"
    `;
    res.json({ ...inserted[0], duration });
  } catch (err) {
    safeError(res, err);
  }
});

// ---------- Fund ----------
app.get('/api/fund', authRequired, async (_req, res) => {
  try {
    if (!needDb(res)) return;
    const fundRows = await sql`SELECT * FROM central_fund WHERE id = 1`;
    const hist = await sql`
      SELECT username, type, amount, note, date_th AS date, time_th AS time
      FROM fund_history ORDER BY created_at DESC LIMIT 50
    `;
    const f = fundRows[0] || {};
    res.json({
      balance: Number(f.balance) || 0,
      allocations: {
        cash: Number(f.cash) || 0,
        deposit: Number(f.deposit) || 0,
        reserve: Number(f.reserve) || 0
      },
      totals: {
        income: Number(f.total_income) || 0,
        expense: Number(f.total_expense) || 0
      },
      history: hist.map((h) => ({
        username: h.username, type: h.type, amount: Number(h.amount),
        note: h.note, date: h.date, time: h.time
      }))
    });
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/fund-tx', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { type, amount, note = '', target } = req.body || {};
    const username = req.user.sub;
    const amt = Number(amount);
    if (!type || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบหรือจำนวนเงินไม่ถูกต้อง' });
    }
    if (type === 'admin_add' && !req.user.isAdmin) {
      return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้น' });
    }
    const t = thaiNow();
    const fundRows = await sql`SELECT * FROM central_fund WHERE id = 1`;
    const f = fundRows[0];
    if (!f) return res.status(500).json({ error: 'ไม่พบข้อมูลกองกลาง' });

    let balance = Number(f.balance);
    let cash = Number(f.cash);
    let deposit = Number(f.deposit);
    let reserve = Number(f.reserve);
    let income = Number(f.total_income);
    let expense = Number(f.total_expense);
    let histType = '';

    if (type === 'deposit') {
      balance += amt; cash += amt; income += amt; histType = 'ฝาก';
    } else if (type === 'withdraw') {
      if (amt > balance) return res.status(400).json({ error: 'ยอดเงินไม่เพียงพอ' });
      balance -= amt; cash = Math.max(0, cash - amt); expense += amt; histType = 'ถอน';
    } else if (type === 'admin_add') {
      if (target === 'deposit') { deposit += amt; balance += amt; histType = 'เพิ่มเงินฝาก'; }
      else { reserve += amt; balance += amt; histType = 'เพิ่มเงินสำรอง'; }
    } else {
      return res.status(400).json({ error: 'ประเภทธุรกรรมไม่ถูกต้อง' });
    }

    await sql`
      UPDATE central_fund SET
        balance = ${balance}, cash = ${cash}, deposit = ${deposit}, reserve = ${reserve},
        total_income = ${income}, total_expense = ${expense}, updated_at = NOW()
      WHERE id = 1
    `;
    await sql`
      INSERT INTO fund_history (username, type, amount, note, date_th, time_th)
      VALUES (${username}, ${histType}, ${amt}, ${note}, ${t.date}, ${t.time})
    `;
    res.json({ ok: true, balance });
  } catch (err) {
    safeError(res, err);
  }
});

// ---------- Stock ----------
app.get('/api/stock', authRequired, async (_req, res) => {
  try {
    if (!needDb(res)) return;
    const rows = await sql`
      SELECT id, name, quantity, min_quantity AS "minQuantity", source,
             added_by AS "addedBy", manual_status AS "manualStatus",
             date_th AS date, time_th AS time
      FROM stock_items ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/stock', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { name, quantity = 0, minQuantity = 0, source = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่ออุปกรณ์' });
    const t = thaiNow();
    const rows = await sql`
      INSERT INTO stock_items (name, quantity, min_quantity, source, added_by, date_th, time_th)
      VALUES (${name}, ${Math.floor(quantity)}, ${Math.floor(minQuantity)},
              ${source || 'ไม่ระบุแหล่งที่มา'}, ${req.user.sub}, ${t.date}, ${t.time})
      RETURNING id, name, quantity, min_quantity AS "minQuantity", source,
                added_by AS "addedBy", manual_status AS "manualStatus",
                date_th AS date, time_th AS time
    `;
    res.json(rows[0]);
  } catch (err) {
    safeError(res, err);
  }
});

app.patch('/api/stock-item', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const id = req.body?.id ?? req.query?.id;
    if (!id) return res.status(400).json({ error: 'ไม่มี id' });
    const { quantity, minQuantity, manualStatus, delta, requester, price = 0, note = '' } = req.body || {};
    if (delta !== undefined) {
      const amt = Math.floor(Number(delta));
      const current = await sql`SELECT id, name, quantity FROM stock_items WHERE id = ${id}`;
      if (!current.length) return res.status(404).json({ error: 'ไม่พบรายการ' });
      const item = current[0];
      const newQty = Math.max(0, Number(item.quantity) + amt);
      if (amt < 0 && Math.abs(amt) > Number(item.quantity)) {
        return res.status(400).json({ error: `สต็อกไม่พอ คงเหลือ ${item.quantity} ชิ้น` });
      }
      await sql`UPDATE stock_items SET quantity = ${newQty}, updated_at = NOW() WHERE id = ${id}`;
      const t = thaiNow();
      await sql`
        INSERT INTO stock_withdrawals (stock_id, stock_name, username, requester, quantity, is_add, price, note, date_th, time_th)
        VALUES (${id}, ${item.name}, ${req.user.sub}, ${requester || null}, ${Math.abs(amt)}, ${amt > 0}, ${price}, ${note}, ${t.date}, ${t.time})
      `;
      return res.json({ ok: true, quantity: newQty });
    }
    if (quantity !== undefined) await sql`UPDATE stock_items SET quantity = ${Math.floor(quantity)}, updated_at = NOW() WHERE id = ${id}`;
    if (minQuantity !== undefined) await sql`UPDATE stock_items SET min_quantity = ${Math.floor(minQuantity)}, updated_at = NOW() WHERE id = ${id}`;
    if (manualStatus !== undefined) await sql`UPDATE stock_items SET manual_status = ${manualStatus}, updated_at = NOW() WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err);
  }
});

app.delete('/api/stock-item', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!req.user.isAdmin && !req.user.canViewMonitoring) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบสต็อก' });
    }
    const id = req.body?.id ?? req.query?.id;
    if (!id) return res.status(400).json({ error: 'ไม่มี id' });
    await sql`DELETE FROM stock_items WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err);
  }
});

app.get('/api/stock-withdrawals', authRequired, monitoringRequired, async (_req, res) => {
  try {
    if (!needDb(res)) return;
    const rows = await sql`
      SELECT id, stock_id AS "stockId", stock_name AS "stockName", username, requester,
             quantity, is_add AS "isAdd", price, note, date_th AS date, time_th AS time
      FROM stock_withdrawals ORDER BY created_at DESC LIMIT 200
    `;
    res.json(rows);
  } catch (err) {
    safeError(res, err);
  }
});

// ---------- Vehicles ----------
app.get('/api/vehicles', authRequired, async (_req, res) => {
  try {
    if (!needDb(res)) return;
    const rows = await sql`
      SELECT id, plate, model, username, note, date_th AS date, time_th AS time
      FROM vehicles ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/vehicles', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { plate, model = '', note = '' } = req.body || {};
    if (!plate) return res.status(400).json({ error: 'กรุณากรอกทะเบียนรถ' });
    const t = thaiNow();
    const rows = await sql`
      INSERT INTO vehicles (plate, model, username, note, date_th, time_th)
      VALUES (${String(plate).toUpperCase()}, ${model}, ${req.user.sub}, ${note}, ${t.date}, ${t.time})
      RETURNING id, plate, model, username, note, date_th AS date, time_th AS time
    `;
    res.json(rows[0]);
  } catch (err) {
    safeError(res, err);
  }
});

app.delete('/api/vehicle-item', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const id = req.body?.id ?? req.query?.id;
    if (!id) return res.status(400).json({ error: 'ไม่มี id' });
    const rows = await sql`SELECT username FROM vehicles WHERE id = ${id}`;
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (rows[0].username !== req.user.sub && !req.user.isAdmin) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบ' });
    }
    await sql`DELETE FROM vehicles WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err);
  }
});

// ---------- Doctors ----------
app.get('/api/doctors', authRequired, async (_req, res) => {
  try {
    if (!needDb(res)) return;
    const rows = await sql`
      SELECT id, name, role, note, added_by AS "addedBy", date_th AS date, time_th AS time
      FROM doctors ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/doctors', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!req.user.isAdmin && !req.user.canViewMonitoring) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เพิ่มรายชื่อแพทย์' });
    }
    const { name, role = '', note = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อแพทย์' });
    const t = thaiNow();
    const rows = await sql`
      INSERT INTO doctors (name, role, note, added_by, date_th, time_th)
      VALUES (${name}, ${role}, ${note}, ${req.user.sub}, ${t.date}, ${t.time})
      RETURNING id, name, role, note, added_by AS "addedBy", date_th AS date, time_th AS time
    `;
    res.json(rows[0]);
  } catch (err) {
    safeError(res, err);
  }
});

app.delete('/api/doctor-item', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!req.user.isAdmin) return res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ลบได้' });
    const id = req.body?.id ?? req.query?.id;
    if (!id) return res.status(400).json({ error: 'ไม่มี id' });
    await sql`DELETE FROM doctors WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err);
  }
});


// ---------- Security / device / ban ----------
app.post('/api/security-check', async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { fingerprint } = req.body || {};
    const ip = clientIp(req);
    const ban = await isBanned({ fingerprint, ip });
    if (ban) {
      await logSecurityEvent({
        eventType: 'blocked_access',
        fingerprint,
        ip,
        detail: ban.reason || 'banned'
      });
      return res.status(403).json({
        banned: true,
        reason: ban.reason || 'บัญชีหรืออุปกรณ์นี้ถูกระงับการใช้งาน'
      });
    }
    res.json({ banned: false, ip });
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/device-report', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { fingerprint, userAgent, screen, platform, language } = req.body || {};
    if (!fingerprint) return res.status(400).json({ error: 'ไม่มี fingerprint' });
    const ip = clientIp(req);
    const ban = await isBanned({ fingerprint, ip });
    if (ban) {
      return res.status(403).json({ banned: true, reason: ban.reason || 'ถูกระงับ' });
    }
    await sql`
      INSERT INTO device_sessions (username, fingerprint, ip_address, user_agent, screen, platform, language)
      VALUES (${req.user.sub}, ${fingerprint}, ${ip}, ${userAgent || null}, ${screen || null}, ${platform || null}, ${language || null})
    `;
    await logSecurityEvent({
      eventType: 'login_device',
      username: req.user.sub,
      fingerprint,
      ip,
      detail: userAgent || ''
    });
    res.json({ ok: true, ip });
  } catch (err) {
    safeError(res, err);
  }
});

app.get('/api/security-bans', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!req.user.isAdmin) return res.status(403).json({ error: 'เฉพาะแอดมิน' });
    const rows = await sql`
      SELECT id, fingerprint, ip_address AS "ipAddress", username, reason,
             banned_by AS "bannedBy", active, created_at AS "createdAt"
      FROM security_bans
      ORDER BY created_at DESC
      LIMIT 200
    `;
    res.json(rows);
  } catch (err) {
    safeError(res, err);
  }
});

app.get('/api/security-sessions', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!req.user.isAdmin) return res.status(403).json({ error: 'เฉพาะแอดมิน' });
    const rows = await sql`
      SELECT id, username, fingerprint, ip_address AS "ipAddress", user_agent AS "userAgent",
             screen, platform, language, last_seen_at AS "lastSeenAt", created_at AS "createdAt"
      FROM device_sessions
      ORDER BY created_at DESC
      LIMIT 300
    `;
    res.json(rows);
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/security-ban', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!req.user.isAdmin) return res.status(403).json({ error: 'เฉพาะแอดมิน' });
    const { fingerprint, ipAddress, username, reason } = req.body || {};
    if (!fingerprint && !ipAddress && !username) {
      return res.status(400).json({ error: 'ระบุ fingerprint หรือ IP หรือ username' });
    }
    const rows = await sql`
      INSERT INTO security_bans (fingerprint, ip_address, username, reason, banned_by, active)
      VALUES (${fingerprint || null}, ${ipAddress || null}, ${username || null}, ${reason || 'ละเมิดกฎ'}, ${req.user.sub}, true)
      RETURNING id
    `;
    await logSecurityEvent({
      eventType: 'ban_created',
      username: req.user.sub,
      fingerprint,
      ip: ipAddress,
      detail: reason || ''
    });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/security-unban', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    if (!req.user.isAdmin) return res.status(403).json({ error: 'เฉพาะแอดมิน' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ไม่มี id' });
    await sql`UPDATE security_bans SET active = false WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err);
  }
});

app.post('/api/security-event', authRequired, async (req, res) => {
  try {
    if (!needDb(res)) return;
    const { eventType, fingerprint, detail } = req.body || {};
    const ip = clientIp(req);
    await logSecurityEvent({
      eventType: eventType || 'client_event',
      username: req.user.sub,
      fingerprint,
      ip,
      detail
    });
    // ถ้าเป็นเหตุร้ายแรง บล็อกทันที (admin เท่านั้นที่กำหนดจากฝั่ง server policy)
    const severe = ['devtools_detected', 'tamper_detected', 'rule_violation'];
    if (severe.includes(eventType) && fingerprint) {
      // บันทึกเหตุการณ์ — การแบนจริงให้แอดมินกด หรือ auto-ban ถ้าต้องการ
      // auto-ban เมื่อตรวจพบ devtools ซ้ำ
      if (eventType === 'rule_violation') {
        await sql`
          INSERT INTO security_bans (fingerprint, ip_address, username, reason, banned_by, active)
          VALUES (${fingerprint}, ${ip}, ${req.user.sub}, ${detail || 'ละเมิดกฎระบบ'}, 'system', true)
        `;
        return res.json({ ok: true, banned: true });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err);
  }
});


app.get('/api/health', async (_req, res) => {
  try {
    if (!sql) return res.status(503).json({ ok: false, error: 'no DATABASE_URL' });
    await sql`SELECT 1`;
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'db error' });
  }
});


module.exports = app;
