/**
 * ป้องกันการใช้ DevTools / Inspect แบบพื้นฐาน
 * หมายเหตุ: ฝั่ง client กันได้แค่ผู้ใช้ทั่วไป — คนที่ตั้งใจข้ามสามารถทำได้
 * ใช้เป็นชั้นป้องกันเสริมเท่านั้น ไม่ใช่ความปลอดภัยหลัก
 */
(function () {
  'use strict';

  const THRESHOLD = 160;
  let devtoolsOpen = false;
  let checkTimer = null;

  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  function redirectAway() {
    try {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0b1220;color:#e2e8f0;font-family:sans-serif;text-align:center;padding:24px;"><div><h1 style="margin:0 0 8px;font-size:1.4rem;">ไม่สามารถใช้งานได้</h1><p style="opacity:.75;margin:0;">กรุณาปิดเครื่องมือนักพัฒนา (DevTools) แล้วรีเฟรชหน้า</p></div></div>';
    } catch (_) {}
  }

  function detectBySize() {
    const widthDiff = window.outerWidth - window.innerWidth > THRESHOLD;
    const heightDiff = window.outerHeight - window.innerHeight > THRESHOLD;
    return widthDiff || heightDiff;
  }

  function onDevtoolsDetected() {
    if (devtoolsOpen) return;
    devtoolsOpen = true;
    redirectAway();
  }

  // ปิดคลิกขวา
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
  });

  // บล็อกคีย์ลัดยอดนิยม
  document.addEventListener('keydown', (e) => {
    const key = e.key || '';
    const code = e.keyCode || e.which;
    // F12
    if (code === 123 || key === 'F12') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'i', 'j', 'c'].includes(key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+U (view source)
    if (e.ctrlKey && (key === 'u' || key === 'U')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+S
    if (e.ctrlKey && (key === 's' || key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Cmd+Option+I (Mac)
    if (e.metaKey && e.altKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // ตรวจขนาดหน้าต่าง (Desktop)
  if (!isMobile()) {
    checkTimer = setInterval(() => {
      if (detectBySize()) onDevtoolsDetected();
    }, 800);
  }

  // debugger trap (เบา ๆ — ถ่วงเวลาเมื่อเปิด DevTools)
  setInterval(() => {
    const start = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    if (performance.now() - start > 100) {
      onDevtoolsDetected();
    }
  }, 2000);

  // ป้องกันลากเลือกบางส่วน (ไม่บล็อก input)
  document.addEventListener('selectstart', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (['INPUT', 'TEXTAREA'].includes(tag) || e.target.isContentEditable) return;
    e.preventDefault();
  });

  // เคลียร์เมื่อออกจากหน้า
  window.addEventListener('beforeunload', () => {
    if (checkTimer) clearInterval(checkTimer);
  });
})();
