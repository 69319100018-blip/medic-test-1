# Medic Shift Log + Neon Database

เวอร์ชันนี้เชื่อม **Neon Postgres** แทน localStorage  
ข้อมูลทุกคนเห็นร่วมกัน เปลี่ยนเครื่องก็ไม่หาย

---

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

### 1. สร้างตารางใน Neon

1. เข้า [Neon Console](https://console.neon.tech) → โปรเจกต์ของคุณ
2. ไปที่ **SQL Editor**
3. คัดลอกเนื้อหาทั้งหมดจากไฟล์ `schema.sql` แล้ววางรัน (Run)

จะได้ตาราง: users, shift_logs, central_fund, fund_history, stock_items, stock_withdrawals, vehicles, doctors  
พร้อมข้อมูลผู้ใช้เริ่มต้น 3 คน

### 2. ตั้งค่า API

```bash
cd api
cp .env.example .env
```

แก้ไฟล์ `.env` ให้เป็น connection string จริงของคุณ (แนะนำใช้ **pooled**):

```env
DATABASE_URL=postgresql://neondb_owner:รหัสผ่าน@ep-gentle-dust-bbuefr44-pooler.c-15.us-east-1.aws.neon.tech/neondb?sslmode=require
PORT=3000
```

ติดตั้งและรัน:

```bash
npm install
npm start
```

จะเห็นข้อความประมาณ:
```
✅ Medic Shift API รันที่ http://localhost:3000
   เปิดหน้าเว็บ: http://localhost:3000/index.html
```

### 3. เปิดใช้งาน

เปิดเบราว์เซอร์ไปที่:

**http://localhost:3000/index.html**

(อย่าเปิดไฟล์ `index.html` ตรง ๆ ด้วย `file://` เพราะ API อยู่ที่พอร์ต 3000)

---

## บัญชีทดสอบ (หลังรัน schema.sql)

| Username           | Password |
|--------------------|----------|
| talos blackagency  | 001      |
| noelle blackagency | 002      |
| jane doe           | 003      |

---

## โครงสร้างใหม่

```
kimi/
├── schema.sql              ← SQL สร้างตาราง (รันใน Neon)
├── index.html
├── dashboard.html
├── css/style.css
├── js/
│   ├── app.js              ← ยังใช้ localStorage (เวอร์ชันเดิม)
│   └── api-client.js       ← ฟังก์ชันเรียก API (สำหรับเชื่อม Neon)
├── api/
│   ├── package.json
│   ├── server.js           ← Express + Neon
│   └── .env                ← ใส่ DATABASE_URL ที่นี่
└── assets/
```

---

## วิธีเปลี่ยน frontend ให้ใช้ Neon (สำคัญ)

ตอนนี้ `app.js` ยังเป็น localStorage  
ต้องแก้ data layer ให้เรียก API แทน

**ทางเลือกที่ง่ายที่สุด:**

1. เปิด `dashboard.html` และ `index.html`
2. เพิ่ม script นี้ **ก่อน** `app.js`:

```html
<script src="js/api-client.js"></script>
```

3. จากนั้นแก้ฟังก์ชันหลักใน `app.js` ตามตัวอย่างด้านล่าง (หรือขอให้ช่วยแก้ไฟล์ทั้งหมดได้)

### ตัวอย่างจุดที่ต้องเปลี่ยนใน app.js

**Login (index.html / app.js):**
```js
// แทนที่การเช็ค users object
const result = await apiLogin(username, password);
currentUser = result.username;
// เก็บ profile จาก result.profile
```

**โหลดข้อมูลตอนเข้า dashboard:**
```js
async function loadAllData() {
  shiftLog = await apiLoadShifts();
  centralFund = await apiLoadFund();
  stockItems = await apiLoadStock();
  vehicles = await apiLoadVehicles();
  doctors = await apiLoadDoctors();
  // ...
}
```

**เข้าเวร:**
```js
async function handleCheckIn() {
  await apiCheckIn(currentUser);
  shiftLog = await apiLoadShifts();
  refreshShiftViews();
}
```

**ออกเวร / บังคับออกเวร:**
```js
await apiCheckOut(currentUser);           // หรือ apiCheckOut(username, true)
```

**เงินกองกลาง:**
```js
await apiFundTransaction({
  username: currentUser,
  type: 'deposit',   // หรือ 'withdraw' / 'admin_add'
  amount,
  note,
  target: 'deposit'  // เฉพาะ admin_add
});
centralFund = await apiLoadFund();
```

**สต็อก / รถ / แพทย์** ก็เรียก `apiAddStock`, `apiAdjustStock`, `apiAddVehicle`, `apiAddDoctor` ฯลฯ ตามลำดับ

---

## Deploy (ทางเลือก)

- รัน API บน Railway / Render / Fly.io / VPS
- ใส่ `DATABASE_URL` ใน Environment Variables ของโฮสต์
- อัปโหลดทั้งโฟลเดอร์ `kimi` (static files) ไปที่เดียวกันหรือ CDN
- แก้ `API_BASE` ใน `api-client.js` ถ้าจำเป็น

---

## ความปลอดภัย

- อย่า commit ไฟล์ `.env`
- รหัสผ่านตอนนี้เก็บแบบ plain text (เพื่อความง่าย) — ควรเปลี่ยนเป็น bcrypt ภายหลัง
- ถ้าเคยแชร์ connection string ในแชท ให้ **รีเซ็ตรหัสผ่านใน Neon** ทันที

---

## ตรวจสอบว่า API ต่อ Neon ได้

เปิด: http://localhost:3000/api/health

ควรได้ `{ "ok": true, "db": "connected" }`
