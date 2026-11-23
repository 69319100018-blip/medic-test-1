# Medic Shift Log

มี 2 โหมด:

1. **localStorage** (เดิม) — เปิดไฟล์ HTML ตรง ๆ ได้เลย ข้อมูลอยู่แค่เครื่องนั้น
2. **Neon Database** (ใหม่) — ข้อมูลกลาง ทุกคนเห็นร่วมกัน → ดูรายละเอียดใน **README-Neon.md**

---

## โครงสร้างโฟลเดอร์

```
kimi/
├── schema.sql              ← SQL สร้างตารางใน Neon
├── README-Neon.md          ← คู่มือเชื่อม Neon (อ่านไฟล์นี้)
├── index.html
├── dashboard.html
├── css/style.css
├── js/
│   ├── app.js              ← logic หลัก
│   ├── api-client.js       ← เรียก API
│   └── neon-bridge.js      ← เชื่อม app.js กับ Neon
├── api/
│   ├── package.json
│   ├── server.js
│   └── .env                ← ใส่ DATABASE_URL
└── assets/
```

## บัญชีทดสอบ

| Username           | Password |
|--------------------|----------|
| talos blackagency  | 001      |
| noelle blackagency | 002      |
| jane doe           | 003      |

## เริ่มใช้กับ Neon (สรุปสั้น)

1. รัน `schema.sql` ใน Neon SQL Editor
2. แก้ `api/.env` ใส่ `DATABASE_URL`
3. `cd api && npm install && npm start`
4. เปิด http://localhost:3000/index.html

รายละเอียดเต็ม → เปิดไฟล์ **README-Neon.md**
