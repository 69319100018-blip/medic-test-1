/**
 * Medic Shift Log API
 * เชื่อม Neon Postgres — รันด้วย: npm install && npm start
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('❌ ไม่พบ DATABASE_URL ใน .env');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

app.use(cors());
app.use(express.json());

// เสิร์ฟไฟล์ static จากโฟลเดอร์แม่ (kimi/)
app.use(express.static(__dirname + '/..'));

// ---------- helpers ----------
function thaiNow() {
  const now = new Date();
  return {
    now,
    date: now.toLocaleDateString('th-TH'),
    time: now.toLocaleTimeString('th-TH', { hour12: false }),
    iso: now.toISOString()
  };
}

// ---------- Auth ----------
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    const rows = await sql`
      SELECT username, display_name AS name, role, avatar,
             is_admin AS "isAdmin", can_view_monitoring AS "canViewMonitoring",
             description AS desc
      FROM users
      WHERE username = ${username.trim().toLowerCase()}
        AND password_hash = ${password}
    `;
    if (!rows.length) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    const u = rows[0];
    res.json({
      username: u.username,
      profile: {
        name: u.name,
        role: u.role,
        avatar: u.avatar,
        isAdmin: u.isAdmin,
        canViewMonitoring: u.canViewMonitoring,
        desc: u.desc
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT username, display_name AS name, role, avatar,
             is_admin AS "isAdmin", can_view_monitoring AS "canViewMonitoring",
             description AS desc
      FROM users ORDER BY username
    `;
    const map = {};
    rows.forEach((r) => {
      map[r.username] = {
        name: r.name,
        role: r.role,
        avatar: r.avatar,
        isAdmin: r.isAdmin,
        canViewMonitoring: r.canViewMonitoring,
        desc: r.desc
      };
    });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Shifts ----------
app.get('/api/shifts', async (req, res) => {
  try {
    const { username } = req.query;
    let rows;
    if (username) {
      rows = await sql`
        SELECT id, username, type, datetime, date_th AS date, time_th AS time,
               duration, is_forced AS "isForced"
        FROM shift_logs
        WHERE username = ${username}
        ORDER BY created_at DESC
        LIMIT 500
      `;
    } else {
      rows = await sql`
        SELECT id, username, type, datetime, date_th AS date, time_th AS time,
               duration, is_forced AS "isForced"
        FROM shift_logs
        ORDER BY created_at DESC
        LIMIT 2000
      `;
    }
    // แปลงเป็นรูปแบบเดิม { username: [logs...] }
    const log = {};
    for (const r of rows) {
      if (!log[r.username]) log[r.username] = [];
      log[r.username].push({
        id: r.id,
        type: r.type,
        datetime: r.datetime,
        date: r.date,
        time: r.time,
        duration: r.duration,
        isForced: r.isForced
      });
    }
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shifts/checkin', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'ไม่มี username' });

    // ตรวจว่ามีเวรค้างวันนี้ไหม
    const open = await sql`
      SELECT id FROM shift_logs
      WHERE username = ${username}
        AND type = 'เข้าเวร'
        AND duration IS NULL
        AND date_th = ${thaiNow().date}
      LIMIT 1
    `;
    if (open.length) return res.status(400).json({ error: 'เข้าเวรอยู่แล้ว' });

    const t = thaiNow();
    const inserted = await sql`
      INSERT INTO shift_logs (username, type, datetime, date_th, time_th)
      VALUES (${username}, 'เข้าเวร', ${t.iso}, ${t.date}, ${t.time})
      RETURNING id, username, type, datetime, date_th AS date, time_th AS time
    `;
    res.json(inserted[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shifts/checkout', async (req, res) => {
  try {
    const { username, isForced = false } = req.body;
    if (!username) return res.status(400).json({ error: 'ไม่มี username' });

    const t = thaiNow();
    const openRows = await sql`
      SELECT id, datetime FROM shift_logs
      WHERE username = ${username}
        AND type = 'เข้าเวร'
        AND duration IS NULL
        AND date_th = ${t.date}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!openRows.length) return res.status(400).json({ error: 'ไม่พบเวรที่ค้างอยู่' });

    const open = openRows[0];
    const diffMin = Math.max(0, Math.floor((t.now - new Date(open.datetime)) / 60000));
    const hours = Math.floor(diffMin / 60);
    const minutes = diffMin % 60;
    const duration = hours > 0 ? `${hours} ชม. ${minutes} นาที` : `${minutes} นาที`;

    await sql`
      UPDATE shift_logs
      SET duration = ${duration}
      WHERE id = ${open.id}
    `;

    const inserted = await sql`
      INSERT INTO shift_logs (username, type, date_th, time_th, duration, is_forced)
      VALUES (${username}, 'ออกเวร', ${t.date}, ${t.time}, ${duration}, ${isForced})
      RETURNING id, username, type, date_th AS date, time_th AS time, duration, is_forced AS "isForced"
    `;
    res.json({ ...inserted[0], duration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Fund ----------
app.get('/api/fund', async (_req, res) => {
  try {
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
        username: h.username,
        type: h.type,
        amount: Number(h.amount),
        note: h.note,
        date: h.date,
        time: h.time
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fund/transaction', async (req, res) => {
  try {
    const { username, type, amount, note = '', target } = req.body;
    // type: 'deposit' | 'withdraw' | 'admin_add'
    // target (สำหรับ admin_add): 'deposit' | 'reserve'
    const amt = Number(amount);
    if (!username || !type || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบหรือจำนวนเงินไม่ถูกต้อง' });
    }

    const t = thaiNow();
    const fundRows = await sql`SELECT * FROM central_fund WHERE id = 1 FOR UPDATE`;
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
      balance += amt;
      cash += amt;
      income += amt;
      histType = 'ฝาก';
    } else if (type === 'withdraw') {
      if (amt > balance) return res.status(400).json({ error: 'ยอดเงินไม่เพียงพอ' });
      balance -= amt;
      cash = Math.max(0, cash - amt);
      expense += amt;
      histType = 'ถอน';
    } else if (type === 'admin_add') {
      if (target === 'deposit') {
        deposit += amt;
        balance += amt;
        histType = 'เพิ่มเงินฝาก';
      } else {
        reserve += amt;
        balance += amt;
        histType = 'เพิ่มเงินสำรอง';
      }
    } else {
      return res.status(400).json({ error: 'ประเภทธุรกรรมไม่ถูกต้อง' });
    }

    await sql`
      UPDATE central_fund SET
        balance = ${balance},
        cash = ${cash},
        deposit = ${deposit},
        reserve = ${reserve},
        total_income = ${income},
        total_expense = ${expense},
        updated_at = NOW()
      WHERE id = 1
    `;

    await sql`
      INSERT INTO fund_history (username, type, amount, note, date_th, time_th)
      VALUES (${username}, ${histType}, ${amt}, ${note}, ${t.date}, ${t.time})
    `;

    res.json({ ok: true, balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Stock ----------
app.get('/api/stock', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT id, name, quantity, min_quantity AS "minQuantity", source,
             added_by AS "addedBy", manual_status AS "manualStatus",
             date_th AS date, time_th AS time
      FROM stock_items ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stock', async (req, res) => {
  try {
    const { name, quantity = 0, minQuantity = 0, source = '', addedBy } = req.body;
    if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่ออุปกรณ์' });
    const t = thaiNow();
    const rows = await sql`
      INSERT INTO stock_items (name, quantity, min_quantity, source, added_by, date_th, time_th)
      VALUES (${name}, ${Math.floor(quantity)}, ${Math.floor(minQuantity)}, ${source || 'ไม่ระบุแหล่งที่มา'}, ${addedBy || null}, ${t.date}, ${t.time})
      RETURNING id, name, quantity, min_quantity AS "minQuantity", source,
                added_by AS "addedBy", manual_status AS "manualStatus",
                date_th AS date, time_th AS time
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/stock/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { quantity, minQuantity, manualStatus, delta, username, requester, price = 0, note = '' } = req.body;

    if (delta !== undefined) {
      // เติมหรือเบิก
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
        VALUES (${id}, ${item.name}, ${username || null}, ${requester || null}, ${Math.abs(amt)}, ${amt > 0}, ${price}, ${note}, ${t.date}, ${t.time})
      `;
      return res.json({ ok: true, quantity: newQty });
    }

    // อัปเดตทั่วไป
    if (quantity !== undefined) {
      await sql`UPDATE stock_items SET quantity = ${Math.floor(quantity)}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (minQuantity !== undefined) {
      await sql`UPDATE stock_items SET min_quantity = ${Math.floor(minQuantity)}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (manualStatus !== undefined) {
      await sql`UPDATE stock_items SET manual_status = ${manualStatus}, updated_at = NOW() WHERE id = ${id}`;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/stock/:id', async (req, res) => {
  try {
    await sql`DELETE FROM stock_items WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stock/withdrawals', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT id, stock_id AS "stockId", stock_name AS "stockName", username, requester,
             quantity, is_add AS "isAdd", price, note, date_th AS date, time_th AS time
      FROM stock_withdrawals ORDER BY created_at DESC LIMIT 200
    `;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Vehicles ----------
app.get('/api/vehicles', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT id, plate, model, username, note, date_th AS date, time_th AS time
      FROM vehicles ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vehicles', async (req, res) => {
  try {
    const { plate, model = '', username, note = '' } = req.body;
    if (!plate) return res.status(400).json({ error: 'กรุณากรอกทะเบียนรถ' });
    const t = thaiNow();
    const rows = await sql`
      INSERT INTO vehicles (plate, model, username, note, date_th, time_th)
      VALUES (${plate.toUpperCase()}, ${model}, ${username || null}, ${note}, ${t.date}, ${t.time})
      RETURNING id, plate, model, username, note, date_th AS date, time_th AS time
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    await sql`DELETE FROM vehicles WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Doctors ----------
app.get('/api/doctors', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT id, name, role, note, added_by AS "addedBy", date_th AS date, time_th AS time
      FROM doctors ORDER BY created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/doctors', async (req, res) => {
  try {
    const { name, role = '', note = '', addedBy } = req.body;
    if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อแพทย์' });
    const t = thaiNow();
    const rows = await sql`
      INSERT INTO doctors (name, role, note, added_by, date_th, time_th)
      VALUES (${name}, ${role}, ${note}, ${addedBy || null}, ${t.date}, ${t.time})
      RETURNING id, name, role, note, added_by AS "addedBy", date_th AS date, time_th AS time
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/doctors/:id', async (req, res) => {
  try {
    await sql`DELETE FROM doctors WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health
app.get('/api/health', async (_req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Medic Shift API รันที่ http://localhost:${PORT}`);
  console.log(`   เปิดหน้าเว็บ: http://localhost:${PORT}/index.html`);
});
