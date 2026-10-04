import { isConfigured, listTests } from './api.js';
import { $, esc, toast, initTheme, setupNotice } from './ui.js';

initTheme();

const nameInput = $('#name-input');
const helloName = $('#hello-name');
let tests = [];

function renderName() {
  const n = localStorage.getItem('student_name') || '';
  nameInput.value = n;
  helloName.textContent = n ? ', ' + n.split(' ').pop() : '';
}

$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = nameInput.value.trim();
  if (!n) return;
  localStorage.setItem('student_name', n);
  renderName();
  toast('Đã lưu tên: ' + n, 'success');
});

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const subj = $('#subject-filter').value;
  const list = tests.filter(t =>
    (!subj || t.subject === subj) &&
    (!q || (t.title + ' ' + t.description + ' ' + t.subject).toLowerCase().includes(q)));

  const box = $('#tests');
  if (!list.length) {
    box.innerHTML = `<div class="card empty" style="grid-column:1/-1"><div class="big">📭</div>
      <p>${tests.length ? 'Không tìm thấy bài phù hợp.' : 'Chưa có bài kiểm tra nào được mở.'}</p></div>`;
    return;
  }
  box.innerHTML = list.map(t => `
    <article class="card test-card" data-id="${t.id}" tabindex="0">
      <div class="meta">
        ${t.subject ? `<span class="chip primary">${esc(t.subject)}</span>` : ''}
        <span class="chip ${t.mode === 'practice' ? 'success' : 'warning'}">${t.mode === 'practice' ? '🎯 Luyện tập' : '📝 Kiểm tra'}</span>
      </div>
      <h3>${esc(t.title)}</h3>
      <p class="desc">${esc(t.description || 'Không có mô tả')}</p>
      <div class="meta">
        <span class="chip">❓ ${t.num_questions} câu</span>
        <span class="chip">⏱️ ${t.duration_min ? t.duration_min + ' phút' : 'Không giới hạn'}</span>
        <span class="chip">👥 ${t.attempts_count} lượt</span>
      </div>
      <button class="btn btn-primary">Làm bài ngay →</button>
    </article>`).join('');
}

$('#tests').addEventListener('click', (e) => {
  const card = e.target.closest('.test-card');
  if (!card) return;
  if (!localStorage.getItem('student_name')) {
    toast('Vui lòng nhập họ tên trước khi làm bài', 'error');
    nameInput.focus();
    return;
  }
  location.href = 'quiz.html?id=' + card.dataset.id;
});
$('#tests').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.click(); });
$('#search').addEventListener('input', render);
$('#subject-filter').addEventListener('change', render);

async function load() {
  renderName();
  if (!isConfigured) return setupNotice($('#tests'));
  try {
    tests = await listTests();
    const subjects = [...new Set(tests.map(t => t.subject).filter(Boolean))];
    $('#subject-filter').innerHTML += subjects.map(s => `<option>${esc(s)}</option>`).join('');
    if (!subjects.length) $('#subject-filter').classList.add('hidden');
    render();
  } catch (err) {
    $('#tests').innerHTML = `<div class="card empty" style="grid-column:1/-1">⚠️ ${esc(err.message)}</div>`;
  }
}
load();
