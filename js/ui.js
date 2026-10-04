// Tiện ích giao diện dùng chung
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, type = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

export function confirmBox(title, message, okText = 'Xác nhận', danger = false) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><p class="muted">${esc(message)}</p>
      <div class="actions"><button class="btn btn-outline" data-x="0">Huỷ</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="1">${esc(okText)}</button></div></div>`;
    wrap.addEventListener('click', e => {
      const x = e.target.dataset.x;
      if (x !== undefined || e.target === wrap) { wrap.remove(); resolve(x === '1'); }
    });
    document.body.appendChild(wrap);
  });
}

export const fmtDuration = (sec) => {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}p ${String(s).padStart(2, '0')}s` : `${s}s`;
};
export const fmtDate = (d) => new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const score10 = (a, b) => (b ? Math.round((a / b) * 100) / 10 : 0);

// ---------- Dark mode ----------
export function initTheme() {
  const saved = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = saved;
  const btn = document.getElementById('theme-btn');
  if (btn) {
    btn.textContent = saved === 'dark' ? '☀️' : '🌙';
    btn.onclick = () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      localStorage.setItem('theme', t);
      btn.textContent = t === 'dark' ? '☀️' : '🌙';
    };
  }
}

export function setupNotice(el) {
  el.innerHTML = `<div class="card setup-box">
    <h2>⚙️ Chưa cấu hình Supabase</h2>
    <p class="muted">Mở file <code>js/config.js</code> và điền <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>.
    Xem hướng dẫn chi tiết trong <code>README.md</code>.</p></div>`;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
