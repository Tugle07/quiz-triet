import { isConfigured, getTest, checkAnswer, submitAttempt, leaderboard } from './api.js';
import { $, $$, esc, toast, confirmBox, initTheme, fmtDuration, fmtDate, pct, score10, shuffle, setupNotice } from './ui.js';

initTheme();
const studentName = localStorage.getItem('student_name');
if (!studentName) location.href = './';
$('#student-name').textContent = studentName;

const params = new URLSearchParams(location.search);
const testId = params.get('id');
if (!testId) location.href = './';

let test = null, questions = [], answers = {}, flags = new Set(), results = {};
let curIdx = 0, startTime = null, timerInt = null, timeLimitSec = 0;
let isSubmitted = false, isReviewMode = false;

async function load() {
  if (!isConfigured) return setupNotice($('#app'));
  try {
    test = await getTest(testId);
    if (!test.questions.length) throw new Error('Bài thi này chưa có câu hỏi nào.');
    
    // Xử lý đảo câu hỏi / đáp án
    questions = test.questions;
    if (test.shuffle_options) {
      questions.forEach(q => {
        const arr = q.options.map((text, idx) => ({ text, idx }));
        q.shuffledOptions = shuffle(arr);
      });
    } else {
      questions.forEach(q => {
        q.shuffledOptions = q.options.map((text, idx) => ({ text, idx }));
      });
    }

    // Khôi phục trạng thái cũ (nếu có)
    const saved = JSON.parse(sessionStorage.getItem('quiz_' + testId) || 'null');
    if (saved && !saved.submitted) {
      answers = saved.answers || {};
      flags = new Set(saved.flags || []);
      if (saved.started_at) startTime = new Date(saved.started_at);
      else startTime = new Date();
    } else {
      startTime = new Date();
    }
    saveState();

    timeLimitSec = test.duration_min ? test.duration_min * 60 : 0;
    if (timeLimitSec) {
      timerInt = setInterval(tick, 1000);
      tick();
    } else {
      $('#timer').classList.add('hidden');
    }

    $('#title').textContent = test.title;
    $('#mode-badge').textContent = test.mode === 'practice' ? 'Luyện tập' : 'Thi thật';
    
    renderPalette();
    jump(0);
    
    $('#loading').classList.add('hidden');
    $('#quiz-ui').classList.remove('hidden');
  } catch (err) {
    $('#loading').innerHTML = `<div class="card empty">⚠️ ${esc(err.message)}</div>`;
  }
}

function saveState() {
  if (isSubmitted) return sessionStorage.removeItem('quiz_' + testId);
  sessionStorage.setItem('quiz_' + testId, JSON.stringify({
    answers, flags: [...flags], started_at: startTime.toISOString()
  }));
}

function tick() {
  if (isSubmitted || !timeLimitSec) return;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const rem = timeLimitSec - elapsed;
  if (rem <= 0) {
    clearInterval(timerInt);
    $('#timer').textContent = '00:00';
    toast('Hết giờ làm bài!', 'warning');
    submit();
    return;
  }
  const m = Math.floor(rem / 60), s = rem % 60;
  $('#timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (rem <= 60) $('#timer').classList.add('low');
}

function renderPalette() {
  $('#palette').innerHTML = questions.map((_, i) => `<button data-i="${i}">${i + 1}</button>`).join('');
  updatePalette();
}

function updatePalette() {
  $$('#palette button').forEach((btn, i) => {
    const q = questions[i];
    btn.className = '';
    if (i === curIdx) btn.classList.add('current');
    if (flags.has(i)) btn.classList.add('flagged');
    
    if (isReviewMode) {
      const res = results[q.id] || {};
      const chosen = answers[q.id];
      if (chosen == null) btn.classList.add('wrong'); // bỏ trống = sai
      else if (chosen === res.correct) btn.classList.add('correct');
      else btn.classList.add('wrong');
    } else {
      if (answers[q.id] != null) btn.classList.add('answered');
      // Chế độ luyện tập: tô màu ngay nếu đã làm
      if (test.mode === 'practice' && results[q.id]) {
        btn.classList.add(answers[q.id] === results[q.id].correct ? 'correct' : 'wrong');
      }
    }
  });
  const done = Object.keys(answers).length;
  $('#progress-bar').style.width = pct(done, questions.length) + '%';
}

async function renderQuestion() {
  const q = questions[curIdx];
  $('#q-number').textContent = `Câu ${curIdx + 1}`;
  $('#q-content').textContent = q.content;
  
  const chosenIdx = answers[q.id];
  const res = results[q.id];
  const lock = isSubmitted || (test.mode === 'practice' && res);
  
  $('#options').innerHTML = q.shuffledOptions.map((opt, i) => {
    const isSelected = chosenIdx === opt.idx;
    let cls = 'option';
    if (isSelected) cls += ' selected';
    if (lock && res) {
      if (opt.idx === res.correct) cls += ' correct';
      else if (isSelected) cls += ' wrong';
    }
    return `<button class="${cls}" data-idx="${opt.idx}" ${lock ? 'disabled' : ''}>
      <div class="key">${String.fromCharCode(65 + i)}</div>
      <div>${esc(opt.text)}</div>
    </button>`;
  }).join('');
  
  const exp = $('#explain');
  if (res && res.explanation) {
    exp.innerHTML = `<b>💡 Giải thích:</b><br>${esc(res.explanation)}`;
    exp.classList.remove('hidden');
  } else {
    exp.classList.add('hidden');
  }
  
  $('#btn-prev').disabled = curIdx === 0;
  $('#btn-next').disabled = curIdx === questions.length - 1;
  $('#btn-flag').textContent = flags.has(curIdx) ? '🚩 Bỏ đánh dấu' : '🏳️ Đánh dấu xem lại';
  
  // Nút Luyện tập
  const existingCheckBtn = $('#btn-check');
  if (existingCheckBtn) existingCheckBtn.remove();
  
  if (test.mode === 'practice' && chosenIdx != null && !res && !isSubmitted) {
    const btn = document.createElement('button');
    btn.id = 'btn-check'; btn.className = 'btn btn-success'; btn.textContent = 'Kiểm tra';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Đang ktra...';
      try {
        const data = await checkAnswer(q.id);
        results[q.id] = data;
        updatePalette(); renderQuestion();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Kiểm tra'; }
    };
    $('#options').appendChild(btn);
  }
}

function jump(idx) {
  if (idx < 0 || idx >= questions.length) return;
  curIdx = idx;
  updatePalette();
  renderQuestion();
}

$('#palette').addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') jump(+e.target.dataset.i);
});
$('#btn-prev').onclick = () => jump(curIdx - 1);
$('#btn-next').onclick = () => jump(curIdx + 1);
$('#btn-flag').onclick = () => {
  if (flags.has(curIdx)) flags.delete(curIdx); else flags.add(curIdx);
  saveState(); updatePalette(); renderQuestion();
};

$('#options').addEventListener('click', e => {
  const btn = e.target.closest('.option');
  if (!btn || btn.disabled) return;
  const q = questions[curIdx];
  answers[q.id] = +btn.dataset.idx;
  saveState();
  updatePalette();
  renderQuestion();
});

// ---------- Submit ----------
$('#btn-submit').onclick = async () => {
  const done = Object.keys(answers).length, tot = questions.length;
  if (done < tot) {
    const ok = await confirmBox('Chưa làm xong', `Bạn còn ${tot - done} câu chưa trả lời. Bạn có chắc chắn muốn nộp bài?`, 'Nộp bài', true);
    if (!ok) return;
  } else {
    const ok = await confirmBox('Nộp bài', 'Bạn đã hoàn thành tất cả câu hỏi. Xác nhận nộp bài?');
    if (!ok) return;
  }
  submit();
};

async function submit() {
  clearInterval(timerInt);
  const btn = $('#btn-submit');
  btn.disabled = true; btn.textContent = 'Đang nộp...';
  try {
    const res = await submitAttempt(test.id, studentName, answers, questions.map(q => q.id), startTime.toISOString());
    isSubmitted = true;
    saveState();
    
    if (res.review) results = res.review;
    
    $('#quiz-ui').classList.add('hidden');
    $('#result-ui').classList.remove('hidden');
    
    const p = pct(res.score, res.total);
    $('#r-score').textContent = res.score;
    $('#r-total').textContent = res.total;
    $('#score-ring').style.setProperty('--p', p);
    $('#score-ring').style.setProperty('--ring', p >= 80 ? 'var(--success)' : p >= 50 ? 'var(--primary)' : 'var(--danger)');
    
    if (p === 100) $('#r-msg').textContent = 'Xuất sắc! Điểm tối đa 🏆';
    else if (p >= 80) $('#r-msg').textContent = 'Giỏi lắm! 👏';
    else if (p >= 50) $('#r-msg').textContent = 'Khá tốt! 👍';
    else $('#r-msg').textContent = 'Cần cố gắng hơn! 💪';
    
    $('#r-desc').textContent = `${studentName} • ${fmtDate(new Date())}`;
    
    // Nếu duration_sec có trong res thì xài, không thì tự tính (trên client)
    const dur = res.duration_sec ?? Math.floor((Date.now() - startTime) / 1000);
    $('#r-time').textContent = fmtDuration(dur);
    $('#r-pct').textContent = p + '%';
    $('#r-10').textContent = score10(res.score, res.total);
    
    if (!res.review && test.mode !== 'practice') $('#btn-review').remove(); // K cho xem lại
    
    loadLeaderboard();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Nộp bài';
  }
}

$('#btn-review')?.addEventListener('click', () => {
  isReviewMode = true;
  $('#result-ui').classList.add('hidden');
  $('#quiz-ui').classList.remove('hidden');
  $('#timer').classList.add('hidden');
  $('#btn-submit').classList.add('hidden');
  updatePalette(); jump(0);
});

async function loadLeaderboard() {
  try {
    const list = await leaderboard(test.id);
    if (!list.length) return;
    $('#leaderboard').classList.remove('hidden');
    $('#lb-table tbody').innerHTML = list.map((r, i) => `<tr>
      <td><b>#${i + 1}</b></td>
      <td>${esc(r.student_name)}</td>
      <td><b>${r.score}</b>/${r.total}</td>
      <td class="muted">${fmtDuration(r.duration_sec)}</td>
      <td class="muted">${fmtDate(r.submitted_at)}</td>
    </tr>`).join('');
  } catch (e) { console.error('Lỗi tải BXH:', e); }
}

load();
