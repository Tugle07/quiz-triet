import { isConfigured, login, logout, isAdmin, adminListTests, adminGetTest, adminGetQuestions, adminGetAttempts, saveTest, setPublished, deleteTest, deleteAttempt } from './api.js';
import { parseFile, downloadExcelTemplate } from './parser.js';
import { $, $$, esc, toast, confirmBox, fmtDate, fmtDuration, pct, setupNotice } from './ui.js';

let curView = '', tests = [], attempts = [], editId = null, editQs = [];

// ---------- Route & Layout ----------
function switchView(view) {
  if (view === curView) return;
  curView = view;
  $$('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  
  if (view === 'dashboard') loadDashboard();
  else if (view === 'tests') loadTests();
  else if (view === 'results') loadResults();
}
window.onhashchange = () => {
  const hash = location.hash.slice(1) || 'dashboard';
  if (hash.startsWith('edit-')) loadEdit(hash.replace('edit-', ''));
  else if (hash === 'new') loadEdit();
  else switchView(hash);
};

// ---------- Auth ----------
async function checkAuth() {
  $('#loading').classList.remove('hidden');
  try {
    if (await isAdmin()) {
      $('#loading').classList.add('hidden');
      $('#admin-ui').classList.remove('hidden');
      window.onhashchange();
    } else {
      $('#loading').classList.add('hidden');
      $('#login-ui').classList.remove('hidden');
    }
  } catch (e) {
    setupNotice($('#loading'));
  }
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#btn-login'); btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
  try {
    await login($('#l-email').value, $('#l-pwd').value);
    $('#login-ui').classList.add('hidden');
    $('#admin-ui').classList.remove('hidden');
    window.onhashchange();
  } catch (err) { toast(err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Đăng nhập';
};

$('#btn-logout').onclick = async () => { await logout(); location.reload(); };

// ---------- Dashboard ----------
async function loadDashboard() {
  try {
    tests = await adminListTests();
    const qCount = tests.reduce((a, b) => a + (b.questions[0]?.count || 0), 0);
    const aCount = tests.reduce((a, b) => a + (b.attempts[0]?.count || 0), 0);
    $('#st-tests').textContent = tests.length;
    $('#st-qs').textContent = qCount;
    $('#st-attempts').textContent = aCount;
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- Tests List ----------
async function loadTests() {
  try {
    tests = await adminListTests();
    $('#tests-table tbody').innerHTML = tests.map(t => `<tr>
      <td><b>${esc(t.title)}</b><br><span class="muted" style="font-size:.8rem">${esc(t.subject || 'Không có môn')}</span></td>
      <td>
        <label class="switch" style="margin:0">
          <input type="checkbox" ${t.published ? 'checked' : ''} onchange="window.togglePub('${t.id}', this.checked)">
          <span style="font-size:.85rem">${t.published ? 'Công khai' : 'Nháp'}</span>
        </label>
      </td>
      <td>${t.questions[0]?.count || 0}</td>
      <td>${t.attempts[0]?.count || 0}</td>
      <td><a href="#edit-${t.id}" class="btn btn-outline btn-sm">Sửa</a></td>
    </tr>`).join('');
    if (!tests.length) $('#tests-table tbody').innerHTML = `<tr><td colspan="5" class="empty">Chưa có bài thi nào</td></tr>`;
  } catch (e) { toast(e.message, 'error'); }
}
window.togglePub = async (id, pub) => {
  try { await setPublished(id, pub); toast('Đã cập nhật trạng thái', 'success'); }
  catch (e) { toast(e.message, 'error'); loadTests(); }
};

$('#btn-new-test').onclick = () => location.hash = 'new';

// ---------- Edit Test ----------
async function loadEdit(id) {
  editId = id; editQs = [];
  switchView('edit-test');
  $('#btn-del-test').classList.toggle('hidden', !id);
  $('#q-list').innerHTML = '';
  if (!id) {
    $('#te-title').textContent = 'Tạo bài thi mới';
    $('#f-title').value = ''; $('#f-desc').value = ''; $('#f-subj').value = '';
    $('#f-dur').value = ''; $('#f-mode').value = 'exam';
    $('#f-pub').checked = false; $('#f-shuf-q').checked = true;
    $('#f-shuf-o').checked = true; $('#f-show-ans').checked = true;
    renderQs();
    return;
  }
  $('#te-title').textContent = 'Đang tải...';
  try {
    const [t, qs] = await Promise.all([adminGetTest(id), adminGetQuestions(id)]);
    $('#te-title').textContent = 'Sửa: ' + t.title;
    $('#f-title').value = t.title; $('#f-desc').value = t.description; $('#f-subj').value = t.subject;
    $('#f-dur').value = t.duration_min || ''; $('#f-mode').value = t.mode;
    $('#f-pub').checked = t.published; $('#f-shuf-q').checked = t.shuffle_questions;
    $('#f-shuf-o').checked = t.shuffle_options; $('#f-show-ans').checked = t.show_answers;
    editQs = qs;
    renderQs();
  } catch (e) { toast(e.message, 'error'); location.hash = 'tests'; }
}

function renderQs() {
  $('#q-count').textContent = editQs.length;
  $('#q-empty').classList.toggle('hidden', editQs.length > 0);
  const h = editQs.map((q, i) => `
    <div class="q-edit ${q.correct < 0 || q.correct >= q.options.length ? 'invalid' : ''}">
      <div class="head"><b>Câu ${i + 1}</b><div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" onclick="window.delQ(${i})" style="color:var(--danger)">Xóa</button></div>
      <textarea placeholder="Nội dung câu hỏi" onchange="window.updQ(${i},'content',this.value)">${esc(q.content)}</textarea>
      <div style="margin: .8rem 0">
        ${q.options.map((o, j) => `
          <div class="opt-row">
            <input type="radio" name="q_ans_${i}" ${q.correct === j ? 'checked' : ''} onchange="window.updQ(${i},'correct',${j})">
            <input value="${esc(o)}" onchange="window.updOpt(${i},${j},this.value)" style="padding:.4rem .6rem">
            <button class="btn btn-ghost" onclick="window.delOpt(${i},${j})" style="padding:.2rem;height:auto">✕</button>
          </div>
        `).join('')}
        <button class="btn btn-outline btn-sm" onclick="window.addOpt(${i})" style="margin-top:.5rem">+ Thêm phương án</button>
      </div>
      <input placeholder="Giải thích (hiện khi xem lại đáp án)" value="${esc(q.explanation)}" onchange="window.updQ(${i},'explanation',this.value)" style="padding:.4rem .6rem;background:var(--warning-soft)">
    </div>
  `).join('');
  // Cập nhật DOM nhanh
  const div = document.createElement('div'); div.innerHTML = h;
  const list = $('#q-list'); list.innerHTML = ''; list.appendChild(div);
}
window.updQ = (i, k, v) => { editQs[i][k] = v; };
window.updOpt = (i, j, v) => { editQs[i].options[j] = v; };
window.delQ = (i) => { if (confirm('Xóa câu này?')) { editQs.splice(i, 1); renderQs(); } };
window.addOpt = (i) => { editQs[i].options.push('Phương án mới'); renderQs(); };
window.delOpt = (i, j) => { editQs[i].options.splice(j, 1); if (editQs[i].correct === j) editQs[i].correct = -1; else if (editQs[i].correct > j) editQs[i].correct--; renderQs(); };

$('#btn-add-q').onclick = () => {
  editQs.push({ content: 'Câu hỏi mới', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: '' });
  renderQs(); window.scrollTo(0, document.body.scrollHeight);
};

$('#btn-save-test').onclick = async () => {
  const title = $('#f-title').value.trim();
  if (!title) return toast('Vui lòng nhập tên bài thi', 'error');
  if (editQs.some(q => q.correct < 0 || q.correct >= q.options.length)) return toast('Có câu hỏi chưa chọn đáp án đúng (khung màu đỏ)', 'error');
  
  const btn = $('#btn-save-test'); btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const payload = {
      id: editId, title, description: $('#f-desc').value.trim(), subject: $('#f-subj').value.trim(),
      duration_min: parseInt($('#f-dur').value) || null, mode: $('#f-mode').value,
      published: $('#f-pub').checked, shuffle_questions: $('#f-shuf-q').checked,
      shuffle_options: $('#f-shuf-o').checked, show_answers: $('#f-show-ans').checked
    };
    const saved = await saveTest(payload, editQs);
    toast('Đã lưu bài thi', 'success');
    if (!editId) location.hash = 'edit-' + saved.id;
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false; btn.textContent = '💾 Lưu bài thi';
};

$('#btn-del-test').onclick = async () => {
  if (await confirmBox('Xoá bài thi', 'Chắc chắn xoá bài thi này và tất cả kết quả của nó?', 'Xóa ngay', true)) {
    try { await deleteTest(editId); toast('Đã xóa', 'success'); location.hash = 'tests'; }
    catch (e) { toast(e.message, 'error'); }
  }
};

// ---------- Import ----------
$('#btn-import').onclick = () => $('#file-input').click();
$('#file-input').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  $('#loading').classList.remove('hidden');
  try {
    const { questions, warnings } = await parseFile(file);
    if (!questions.length) throw new Error('Không tìm thấy câu hỏi nào hợp lệ');
    editQs.push(...questions);
    renderQs();
    if (warnings.length) confirmBox('Cảnh báo khi đọc file', warnings.join('\n'));
    toast(`Đã thêm ${questions.length} câu`, 'success');
  } catch (err) { toast('Lỗi đọc file: ' + err.message, 'error'); }
  $('#loading').classList.add('hidden');
};

// ---------- Results ----------
async function loadResults() {
  try {
    const allTests = await adminListTests();
    const sel = $('#rs-test-sel');
    sel.innerHTML = '<option value="">Tất cả bài thi</option>' + allTests.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
    
    attempts = await adminGetAttempts(sel.value);
    renderResults();
  } catch (e) { toast(e.message, 'error'); }
}
$('#rs-test-sel').onchange = async (e) => {
  try { attempts = await adminGetAttempts(e.target.value); renderResults(); }
  catch (err) { toast(err.message, 'error'); }
};
function renderResults() {
  $('#attempts-table tbody').innerHTML = attempts.map(a => `<tr>
    <td><b>${esc(a.student_name)}</b></td>
    <td>${esc(a.tests?.title)}</td>
    <td><b>${a.score}</b>/${a.total} <span class="muted">(${pct(a.score, a.total)}%)</span></td>
    <td>${fmtDuration(a.duration_sec)}</td>
    <td class="muted">${fmtDate(a.submitted_at)}</td>
    <td><button class="btn btn-ghost btn-sm" onclick="window.delAtt('${a.id}')" style="color:var(--danger)">Xóa</button></td>
  </tr>`).join('');
  if (!attempts.length) $('#attempts-table tbody').innerHTML = `<tr><td colspan="6" class="empty">Chưa có lượt làm bài nào</td></tr>`;
}
window.delAtt = async (id) => {
  if (!confirm('Xóa kết quả này?')) return;
  try { await deleteAttempt(id); attempts = attempts.filter(a => a.id !== id); renderResults(); }
  catch (e) { toast(e.message, 'error'); }
};

$('#btn-export-csv').onclick = () => {
  if (!attempts.length) return toast('Không có dữ liệu', 'warning');
  const csv = '\uFEFF' + ['Tên', 'Bài thi', 'Điểm', 'Tổng câu', 'Phần trăm', 'Thời gian (s)', 'Nộp lúc']
    .join(',') + '\n' + attempts.map(a => [
      `"${a.student_name.replace(/"/g, '""')}"`, `"${(a.tests?.title || '').replace(/"/g, '""')}"`,
      a.score, a.total, pct(a.score, a.total), a.duration_sec, `"${fmtDate(a.submitted_at)}"`
    ].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'ket_qua.csv'; a.click();
};

if (isConfigured) checkAuth(); else setupNotice($('#loading'));
