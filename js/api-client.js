/**
 * Medic Shift Log — API Client (Secure + JWT)
 */
const API_BASE = (window.location.origin.includes('localhost') || window.location.protocol === 'file:')
  ? 'http://localhost:3000'
  : '';

const TOKEN_KEY = 'medicToken';
const USER_KEY = 'medicUser';
const PROFILE_KEY = 'medicProfile';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function setSession(username, profile, token) {
  sessionStorage.setItem(TOKEN_KEY, token || '');
  sessionStorage.setItem(USER_KEY, username || '');
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile || {}));
}

function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(PROFILE_KEY);
}

async function api(path, options = {}) {
  const url = `${API_BASE}/api${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearSession();
    if (!window.location.pathname.includes('index')) {
      window.location.href = 'index.html';
    }
    throw new Error(data.error || 'ต้องเข้าสู่ระบบก่อน');
  }
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('ไม่พบ API (404) — ตรวจว่า deploy ฝั่ง serverless และตั้ง DATABASE_URL / JWT_SECRET บน Vercel แล้ว');
    }
    if (res.status === 503) {
      throw new Error(data.error || 'เซิร์ฟเวอร์ยังไม่พร้อม (ตรวจ Environment Variables)');
    }
    throw new Error(data.error || res.statusText || 'API error');
  }
  return data;
}

async function apiLogin(username, password) {
  const data = await api('/login', { method: 'POST', body: { username, password } });
  if (data.token) setSession(data.username, data.profile, data.token);
  return data;
}

async function apiLoadUsers() {
  return api('/users');
}

async function apiLoadShifts(username) {
  const q = username ? `?username=${encodeURIComponent(username)}` : '';
  return api(`/shifts${q}`);
}

async function apiCheckIn() {
  return api('/shifts/checkin', { method: 'POST', body: {} });
}

async function apiCheckOut(username, isForced = false) {
  return api('/shifts/checkout', {
    method: 'POST',
    body: { isForced, username: isForced ? username : undefined }
  });
}

async function apiLoadFund() {
  return api('/fund');
}

async function apiFundTransaction(payload) {
  return api('/fund/transaction', { method: 'POST', body: payload });
}

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

async function apiLoadVehicles() {
  return api('/vehicles');
}

async function apiAddVehicle(v) {
  return api('/vehicles', { method: 'POST', body: v });
}

async function apiDeleteVehicle(id) {
  return api(`/vehicles/${id}`, { method: 'DELETE' });
}

async function apiLoadDoctors() {
  return api('/doctors');
}

async function apiAddDoctor(d) {
  return api('/doctors', { method: 'POST', body: d });
}

async function apiDeleteDoctor(id) {
  return api(`/doctors/${id}`, { method: 'DELETE' });
}
