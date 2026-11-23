/**
 * Medic Shift Log — API Client (Neon)
 * ใช้แทน localStorage ทั้งหมด
 * ต้องรัน API server ก่อน (โฟลเดอร์ api/)
 */
const API_BASE = window.location.origin.includes('localhost') || window.location.protocol === 'file:'
  ? 'http://localhost:3000'
  : ''; // ถ้า deploy ร่วมกับ API ใช้ relative path

async function api(path, options = {}) {
  const url = `${API_BASE}/api${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || 'API error');
  return data;
}

// ---------- Auth ----------
async function apiLogin(username, password) {
  return api('/login', { method: 'POST', body: { username, password } });
}

async function apiLoadUsers() {
  return api('/users');
}

// ---------- Shifts ----------
async function apiLoadShifts(username) {
  const q = username ? `?username=${encodeURIComponent(username)}` : '';
  return api(`/shifts${q}`);
}

async function apiCheckIn(username) {
  return api('/shifts/checkin', { method: 'POST', body: { username } });
}

async function apiCheckOut(username, isForced = false) {
  return api('/shifts/checkout', { method: 'POST', body: { username, isForced } });
}

// ---------- Fund ----------
async function apiLoadFund() {
  return api('/fund');
}

async function apiFundTransaction(payload) {
  return api('/fund/transaction', { method: 'POST', body: payload });
}

// ---------- Stock ----------
async function apiLoadStock() {
  return api('/stock');
}

async function apiAddStock(item) {
  return api('/stock', { method: 'POST', body: item });
}

async function apiAdjustStock(id, delta, meta = {}) {
  return api(`/stock/${id}`, { method: 'PATCH', body: { delta, ...meta } });
}

async function apiUpdateStock(id, fields) {
  return api(`/stock/${id}`, { method: 'PATCH', body: fields });
}

async function apiDeleteStock(id) {
  return api(`/stock/${id}`, { method: 'DELETE' });
}

async function apiLoadStockWithdrawals() {
  return api('/stock/withdrawals');
}

// ---------- Vehicles ----------
async function apiLoadVehicles() {
  return api('/vehicles');
}

async function apiAddVehicle(v) {
  return api('/vehicles', { method: 'POST', body: v });
}

async function apiDeleteVehicle(id) {
  return api(`/vehicles/${id}`, { method: 'DELETE' });
}

// ---------- Doctors ----------
async function apiLoadDoctors() {
  return api('/doctors');
}

async function apiAddDoctor(d) {
  return api('/doctors', { method: 'POST', body: d });
}

async function apiDeleteDoctor(id) {
  return api(`/doctors/${id}`, { method: 'DELETE' });
}
