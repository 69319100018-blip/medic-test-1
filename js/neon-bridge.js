/**
 * Neon Bridge (Secure) — JWT session + API overrides
 */
(function () {
  'use strict';

  if (typeof api !== 'function') {
    console.warn('[Neon] ไม่พบ api-client.js');
    return;
  }

  console.log('[Neon] Secure mode');

  // ---------- Login ----------
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const username = (document.getElementById('usernameInput')?.value || '').trim().toLowerCase();
      const password = document.getElementById('passwordInput')?.value || '';
      const btn = document.getElementById('btnLogin');
      if (btn) btn.disabled = true;
      try {
        const result = await apiLogin(username, password);
        // sync key ที่ app.js ใช้ตรวจ session
        sessionStorage.setItem('loggedInUser', result.username);
        if (typeof userProfiles !== 'undefined') {
          userProfiles[result.username] = result.profile;
        }
        window.location.href = 'dashboard.html';
      } catch (err) {
        if (window.Swal) Swal.fire('เข้าสู่ระบบไม่สำเร็จ', err.message || 'ลองใหม่', 'error');
        else alert(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
      } finally {
        if (btn) btn.disabled = false;
      }
    }, true);
  });

  // ---------- Dashboard ----------
  if (window.location.pathname.includes('dashboard') || document.body.classList.contains('dashboard-body')) {
    const savedUser = sessionStorage.getItem('medicUser');
    const savedProfile = sessionStorage.getItem('medicProfile');
    const token = sessionStorage.getItem('medicToken');
    if (!savedUser || !token) {
      window.location.href = 'index.html';
      return;
    }

    window.loadAllData = async function () {
      try {
        currentUser = savedUser;
        if (savedProfile && typeof userProfiles !== 'undefined') {
          userProfiles[savedUser] = JSON.parse(savedProfile);
        }
        try {
          const allUsers = await apiLoadUsers();
          Object.assign(userProfiles || {}, allUsers);
        } catch (_) {}

        shiftLog = await apiLoadShifts();
        centralFund = await apiLoadFund();
        stockItems = await apiLoadStock();
        vehicles = await apiLoadVehicles();
        doctors = await apiLoadDoctors();
        if (typeof canViewMonitoring === 'function' && canViewMonitoring(currentUser)) {
          try { stockWithdrawals = await apiLoadStockWithdrawals(); } catch (_) { stockWithdrawals = []; }
        }
        stockOffline = false;
        vehicleOffline = false;
        doctorsOffline = false;
      } catch (err) {
        console.error('[Neon]', err);
        if (window.Swal) Swal.fire('เชื่อมต่อฐานข้อมูลไม่ได้', err.message, 'error');
      }
    };

    window.saveShiftLog = () => {};
    window.saveFund = () => {};
    window.saveStockLocal = () => {};
    window.saveVehicleLocal = () => {};
    window.saveDoctorsLocal = () => {};
    window.saveStockWithdrawalsLocal = () => {};

    window.handleCheckIn = async function () {
      const btn = document.getElementById('btnCheckIn');
      if (btn) btn.disabled = true;
      try {
        await apiCheckIn();
        shiftLog = await apiLoadShifts();
        if (typeof refreshShiftViews === 'function') refreshShiftViews();
        if (typeof celebrate === 'function') {
          celebrate({ particleCount: 110, spread: 80, origin: { y: 0.65 }, colors: ['#22c55e', '#2563eb', '#a78bfa', '#fbbf24'] });
        }
        if (typeof showAlert === 'function') {
          showAlert('เข้าเวรสำเร็จ', `${userProfiles[currentUser]?.name || currentUser} เข้าเวรเรียบร้อย`, 'success');
        }
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('เข้าเวรไม่สำเร็จ', err.message, 'error');
      } finally {
        if (typeof updateActionButtons === 'function') updateActionButtons();
      }
    };

    window.handleCheckOut = async function () {
      const btn = document.getElementById('btnCheckOut');
      if (btn) btn.disabled = true;
      try {
        const result = await apiCheckOut(currentUser, false);
        shiftLog = await apiLoadShifts();
        if (typeof refreshShiftViews === 'function') refreshShiftViews();
        if (typeof celebrate === 'function') {
          celebrate({ particleCount: 60, spread: 60, origin: { y: 0.65 }, colors: ['#f87171', '#fb923c', '#fbbf24'] });
        }
        if (typeof showAlert === 'function') {
          showAlert('ออกเวรสำเร็จ', `${userProfiles[currentUser]?.name || currentUser} ออกเวรเรียบร้อย (${result.duration || ''})`, 'success');
        }
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ออกเวรไม่สำเร็จ', err.message, 'error');
      } finally {
        if (typeof updateActionButtons === 'function') updateActionButtons();
      }
    };

    window.confirmForceOut = async function (username) {
      try {
        await apiCheckOut(username, true);
        shiftLog = await apiLoadShifts();
        if (typeof refreshShiftViews === 'function') refreshShiftViews();
        if (typeof showAlert === 'function') {
          showAlert('ออกเวรสำเร็จ', `${userProfiles[username]?.name || username} ถูกออกเวรเรียบร้อยแล้ว`, 'success');
        }
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ทำรายการไม่สำเร็จ', err.message, 'error');
      }
    };

    window.handleFundTransaction = async function (type) {
      const amountInput = document.getElementById('fundAmountInput');
      const noteInput = document.getElementById('fundNoteInput');
      const amount = Number(amountInput?.value);
      if (!amountInput || !Number.isFinite(amount) || amount <= 0) {
        if (typeof showAlert === 'function') showAlert('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกจำนวนเงินที่มากกว่า 0', 'warning');
        return;
      }
      const btn = document.getElementById(type === 'deposit' ? 'btnFundDeposit' : 'btnFundWithdraw');
      if (btn) btn.disabled = true;
      try {
        await apiFundTransaction({ type, amount, note: noteInput?.value.trim() || '' });
        centralFund = await apiLoadFund();
        if (typeof renderCentralFund === 'function') renderCentralFund();
        amountInput.value = '';
        if (noteInput) noteInput.value = '';
        if (typeof celebrate === 'function') {
          celebrate({ particleCount: 70, spread: 65, origin: { y: 0.6 }, colors: ['#fbbf24', '#f59e0b', '#22c55e'] });
        }
        if (typeof showAlert === 'function') {
          showAlert(`${type === 'deposit' ? 'ฝากเงิน' : 'ถอนเงิน'}สำเร็จ`, `จำนวน ${amount.toLocaleString('th-TH')} บาท เรียบร้อย`, 'success');
        }
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ทำรายการไม่สำเร็จ', err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    window.handleFundAdminAdd = async function (target) {
      if (typeof isAdmin === 'function' && !isAdmin(currentUser)) return;
      const amountInput = document.getElementById('fundAdminAmountInput');
      const noteInput = document.getElementById('fundAdminNoteInput');
      const amount = Number(amountInput?.value);
      if (!amountInput || !Number.isFinite(amount) || amount <= 0) {
        if (typeof showAlert === 'function') showAlert('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกจำนวนเงินที่มากกว่า 0', 'warning');
        return;
      }
      const btn = document.getElementById(target === 'deposit' ? 'btnFundAddDeposit' : 'btnFundAddReserve');
      if (btn) btn.disabled = true;
      try {
        await apiFundTransaction({ type: 'admin_add', target, amount, note: noteInput?.value.trim() || '' });
        centralFund = await apiLoadFund();
        if (typeof renderCentralFund === 'function') renderCentralFund();
        amountInput.value = '';
        if (noteInput) noteInput.value = '';
        if (typeof showAlert === 'function') {
          showAlert('เพิ่มเงินสำเร็จ', `เพิ่ม${target === 'deposit' ? 'เงินฝาก' : 'เงินสำรอง'} ${amount.toLocaleString('th-TH')} บาท เรียบร้อย`, 'success');
        }
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ทำรายการไม่สำเร็จ', err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    window.handleAddStock = async function () {
      const nameInput = document.getElementById('stockNameInput');
      const qtyInput = document.getElementById('stockQtyInput');
      const minInput = document.getElementById('stockMinInput');
      const sourceInput = document.getElementById('stockSourceInput');
      const name = nameInput?.value.trim();
      const quantity = Math.max(0, Math.floor(Number(qtyInput?.value) || 0));
      const minQuantity = Math.max(0, Math.floor(Number(minInput?.value) || 0));
      const source = sourceInput?.value.trim() || '';
      if (!name) {
        if (typeof showAlert === 'function') showAlert('ข้อมูลไม่ครบ', 'กรุณากรอกชื่ออุปกรณ์', 'warning');
        return;
      }
      const btn = document.getElementById('btnAddStock');
      if (btn) btn.disabled = true;
      try {
        await apiAddStock({ name, quantity, minQuantity, source });
        stockItems = await apiLoadStock();
        if (typeof renderStock === 'function') renderStock();
        nameInput.value = ''; qtyInput.value = ''; minInput.value = ''; sourceInput.value = '';
        if (typeof showAlert === 'function') showAlert('เพิ่มสต็อกสำเร็จ', `${name} จำนวน ${quantity.toLocaleString('th-TH')} ชิ้น`, 'success');
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('เพิ่มสต็อกไม่สำเร็จ', err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    window.promptAdjustStock = async function (id, direction) {
      const item = stockItems.find((s) => String(s.id) === String(id));
      if (!item) return;
      const isAdd = direction > 0;
      let amount = 1;
      let requester = '';
      let price = 0;

      if (window.Swal) {
        if (isAdd) {
          const result = await Swal.fire({
            title: `เติมสต็อก "${item.name}"`,
            input: 'number', inputValue: 1,
            inputAttributes: { min: 1, step: 1 },
            showCancelButton: true, confirmButtonText: 'เติมสต็อก', cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#16a34a'
          });
          if (!result.isConfirmed) return;
          amount = Math.floor(Number(result.value)) || 1;
        } else {
          const { value: formValues } = await Swal.fire({
            title: `เบิก/ใช้ "${item.name}"`,
            html: '<input id="swal-qty" type="number" min="1" value="1" class="swal2-input" placeholder="จำนวน">' +
                  '<input id="swal-req" class="swal2-input" placeholder="ชื่อผู้เบิก">' +
                  '<input id="swal-price" type="number" min="0" value="0" class="swal2-input" placeholder="ราคา (ถ้ามี)">',
            focusConfirm: false, showCancelButton: true, confirmButtonText: 'เบิก', cancelButtonText: 'ยกเลิก',
            preConfirm: () => ({
              qty: Math.floor(Number(document.getElementById('swal-qty').value)) || 1,
              requester: document.getElementById('swal-req').value.trim(),
              price: Number(document.getElementById('swal-price').value) || 0
            })
          });
          if (!formValues) return;
          amount = formValues.qty;
          requester = formValues.requester;
          price = formValues.price;
        }
      } else {
        const raw = prompt(isAdd ? 'จำนวนที่เติม:' : 'จำนวนที่เบิก:', '1');
        if (raw === null) return;
        amount = Math.floor(Number(raw)) || 1;
      }

      const delta = isAdd ? amount : -amount;
      try {
        await apiAdjustStock(id, delta, { requester, price });
        stockItems = await apiLoadStock();
        if (typeof canViewMonitoring === 'function' && canViewMonitoring(currentUser)) {
          try { stockWithdrawals = await apiLoadStockWithdrawals(); } catch (_) {}
        }
        if (typeof renderStock === 'function') renderStock();
        if (typeof showAlert === 'function') {
          showAlert(isAdd ? 'เติมสต็อกสำเร็จ' : 'เบิกสต็อกสำเร็จ', `${item.name} ${amount} ชิ้น`, 'success');
        }
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ทำรายการไม่สำเร็จ', err.message, 'error');
      }
    };

    window.confirmRemoveStock = async function (id) {
      if (window.Swal) {
        const r = await Swal.fire({ title: 'ลบรายการสต็อก?', text: 'ไม่สามารถกู้คืนได้', icon: 'warning', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#dc2626' });
        if (!r.isConfirmed) return;
      } else if (!confirm('ลบรายการนี้?')) return;
      try {
        await apiDeleteStock(id);
        stockItems = await apiLoadStock();
        if (typeof renderStock === 'function') renderStock();
        if (typeof showAlert === 'function') showAlert('ลบสำเร็จ', '', 'success');
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ลบไม่สำเร็จ', err.message, 'error');
      }
    };

    window.handleAddVehicle = async function () {
      const plateInput = document.getElementById('vehiclePlateInput');
      const modelInput = document.getElementById('vehicleModelInput');
      const noteInput = document.getElementById('vehicleNoteInput');
      const plate = plateInput?.value.trim();
      const model = modelInput?.value.trim() || '';
      const note = noteInput?.value.trim() || '';
      if (!plate) {
        if (typeof showAlert === 'function') showAlert('ข้อมูลไม่ครบ', 'กรุณากรอกทะเบียนรถ', 'warning');
        return;
      }
      const btn = document.getElementById('btnAddVehicle');
      if (btn) btn.disabled = true;
      try {
        await apiAddVehicle({ plate, model, note });
        vehicles = await apiLoadVehicles();
        if (typeof renderVehicles === 'function') renderVehicles();
        if (plateInput) plateInput.value = '';
        if (modelInput) modelInput.value = '';
        if (noteInput) noteInput.value = '';
        if (typeof showAlert === 'function') showAlert('เพิ่มรถสำเร็จ', plate.toUpperCase(), 'success');
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('เพิ่มรถไม่สำเร็จ', err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    window.confirmRemoveVehicle = async function (id) {
      if (window.Swal) {
        const r = await Swal.fire({ title: 'ลบรถคันนี้?', icon: 'warning', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#dc2626' });
        if (!r.isConfirmed) return;
      } else if (!confirm('ลบ?')) return;
      try {
        await apiDeleteVehicle(id);
        vehicles = await apiLoadVehicles();
        if (typeof renderVehicles === 'function') renderVehicles();
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ลบไม่สำเร็จ', err.message, 'error');
      }
    };

    window.handleAddDoctor = async function () {
      if (typeof canManageDoctors === 'function' && !canManageDoctors(currentUser)) {
        if (typeof showAlert === 'function') showAlert('ไม่มีสิทธิ์', 'เฉพาะแอดมินและผู้อำนวยการเท่านั้น', 'warning');
        return;
      }
      const nameInput = document.getElementById('doctorNameInput');
      const roleInput = document.getElementById('doctorRoleInput');
      const noteInput = document.getElementById('doctorNoteInput');
      const name = nameInput?.value.trim();
      const role = roleInput?.value.trim() || '';
      const note = noteInput?.value.trim() || '';
      if (!name) {
        if (typeof showAlert === 'function') showAlert('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อแพทย์', 'warning');
        return;
      }
      const btn = document.getElementById('btnAddDoctor');
      if (btn) btn.disabled = true;
      try {
        await apiAddDoctor({ name, role, note });
        doctors = await apiLoadDoctors();
        if (typeof renderDoctors === 'function') renderDoctors();
        if (nameInput) nameInput.value = '';
        if (roleInput) roleInput.value = '';
        if (noteInput) noteInput.value = '';
        if (typeof showAlert === 'function') showAlert('เพิ่มรายชื่อสำเร็จ', name, 'success');
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('เพิ่มไม่สำเร็จ', err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    window.confirmRemoveDoctor = async function (id) {
      if (window.Swal) {
        const r = await Swal.fire({ title: 'ลบรายชื่อนี้?', icon: 'warning', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#dc2626' });
        if (!r.isConfirmed) return;
      } else if (!confirm('ลบ?')) return;
      try {
        await apiDeleteDoctor(id);
        doctors = await apiLoadDoctors();
        if (typeof renderDoctors === 'function') renderDoctors();
      } catch (err) {
        if (typeof showAlert === 'function') showAlert('ลบไม่สำเร็จ', err.message, 'error');
      }
    };

    document.getElementById('btnLogout')?.addEventListener('click', () => {
      if (typeof clearSession === 'function') clearSession();
      sessionStorage.removeItem('medicUser');
      sessionStorage.removeItem('medicProfile');
      sessionStorage.removeItem('medicToken');
      sessionStorage.removeItem('loggedInUser');
    }, true);

    const boot = () => {
      setTimeout(() => {
        if (typeof loadAllData === 'function') {
          loadAllData().then(() => {
            if (typeof refreshShiftViews === 'function') refreshShiftViews();
            if (typeof renderCentralFund === 'function') renderCentralFund();
            if (typeof renderStock === 'function') renderStock();
            if (typeof renderVehicles === 'function') renderVehicles();
            if (typeof renderDoctors === 'function') renderDoctors();
          });
        }
      }, 100);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
