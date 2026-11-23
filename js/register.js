(function () {
  'use strict';

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const form = document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = (document.getElementById('regUsername')?.value || '').trim().toLowerCase();
    const displayName = (document.getElementById('regDisplayName')?.value || '').trim();
    const password = document.getElementById('regPassword')?.value || '';
    const password2 = document.getElementById('regPassword2')?.value || '';
    const btn = document.getElementById('btnRegister');

    if (!username || !displayName || !password) {
      if (window.Swal) Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกให้ครบทุกช่อง', 'warning');
      return;
    }
    if (password.length < 4) {
      if (window.Swal) Swal.fire('รหัสผ่านสั้นเกินไป', 'อย่างน้อย 4 ตัวอักษร', 'warning');
      return;
    }
    if (password !== password2) {
      if (window.Swal) Swal.fire('รหัสผ่านไม่ตรงกัน', 'กรุณาตรวจสอบอีกครั้ง', 'warning');
      return;
    }

    if (btn) btn.disabled = true;
    try {
      await apiRegister({ username, displayName, password });
      if (window.Swal) {
        await Swal.fire({
          icon: 'success',
          title: 'สมัครสำเร็จ',
          text: 'รอแอดมินปรับตำแหน่ง/role ได้ตามต้องการ — เข้าสู่ระบบได้เลย',
          confirmButtonText: 'ไปหน้าเข้าสู่ระบบ'
        });
      }
      window.location.href = 'index.html';
    } catch (err) {
      if (window.Swal) Swal.fire('สมัครไม่สำเร็จ', err.message || 'ลองใหม่', 'error');
      else alert(err.message || 'สมัครไม่สำเร็จ');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
})();
