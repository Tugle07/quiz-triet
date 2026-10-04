// =====================================================================
// Bộ đọc file câu hỏi: Word (.docx), Excel (.xlsx/.csv), Text (AIKEN)
// Trả về { questions: [{content, options[], correct, explanation}], warnings[] }
// correct = -1 nghĩa là chưa xác định được đáp án đúng (admin chọn tay ở màn Preview)
// =====================================================================
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const RE_QUESTION = /^\s*(?:câu(?:\s*hỏi)?\s*)?(\d{1,4})\s*[.:)\]]\s*/i;
const RE_SCORE_LINE = /^\(?\s*\d+([.,]\d+)?\s*điểm\s*\)?$/i;
const RE_OPTION_PREFIX = /^\s*([A-Fa-f])\s*[.)]\s+/;
const RE_ANSWER_LINE = /^\s*(?:answer|đáp\s*án(?:\s*đúng)?|đ\/a)\s*[:：]\s*([A-Fa-f1-6])\b/i;

const clean = (s) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
const stripOptPrefix = (s) => s.replace(RE_OPTION_PREFIX, '').trim();
const letterToIdx = (c) => (/\d/.test(c) ? parseInt(c, 10) - 1 : c.toUpperCase().charCodeAt(0) - 65);

// ---------------------------------------------------------------- DOCX
function readParagraphs(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let text = '';
    const marks = { highlight: 0, color: 0, bold: 0, underline: 0 };
    let chars = 0;
    for (const r of p.getElementsByTagNameNS(W, 'r')) {
      let t = '';
      for (const n of r.childNodes) {
        if (n.localName === 't') t += n.textContent;
        else if (n.localName === 'tab' || n.localName === 'br') t += ' ';
      }
      if (!t) continue;
      text += t;
      const len = t.replace(/\s/g, '').length;
      if (!len) continue;
      chars += len;
      const rPr = [...r.childNodes].find(n => n.localName === 'rPr');
      if (!rPr) continue;
      const get = (name) => [...rPr.childNodes].find(n => n.localName === name);
      const val = (el, a = 'val') => el && (el.getAttributeNS(W, a) || el.getAttribute('w:' + a));
      const hl = get('highlight'), shd = get('shd'), col = get('color'), b = get('b'), u = get('u');
      const fill = val(shd, 'fill');
      if ((hl && val(hl) !== 'none') || (fill && !/^(auto|ffffff|000000)$/i.test(fill))) marks.highlight += len;
      const c = val(col);
      if (c && !/^(auto|000000)$/i.test(c)) marks.color += len;
      if (b && val(b) !== '0' && val(b) !== 'false') marks.bold += len;
      if (u && val(u) && val(u) !== 'none') marks.underline += len;
    }
    const t = clean(text);
    if (!t) continue;
    const m = {};
    for (const k in marks) m[k] = chars > 0 && marks[k] / chars > 0.5;
    paras.push({ text: t, marks: m });
  }
  return paras;
}

function pickCorrectByFormat(opts) {
  // Đáp án đúng = phương án duy nhất có định dạng khác biệt (highlight > màu chữ > gạch chân > in đậm)
  for (const k of ['highlight', 'color', 'underline', 'bold']) {
    const hits = opts.map((o, i) => (o.marks && o.marks[k] ? i : -1)).filter(i => i >= 0);
    if (hits.length === 1) return hits[0];
  }
  return -1;
}

function buildQuestions(paras) {
  const raw = [];
  let cur = null;
  for (const p of paras) {
    if (RE_SCORE_LINE.test(p.text)) continue;
    const ans = p.text.match(RE_ANSWER_LINE);
    if (ans && cur) { cur.answerLine = letterToIdx(ans[1]); continue; }
    if (RE_QUESTION.test(p.text) && (!cur || cur.opts.length >= 2)) {
      if (cur) raw.push(cur);
      cur = { content: p.text.replace(RE_QUESTION, ''), opts: [] };
    } else if (cur) {
      cur.opts.push({ text: p.text, marks: p.marks });
    }
  }
  if (cur) raw.push(cur);
  return raw;
}

function finalize(raw) {
  const warnings = [];
  const questions = raw.map((q, qi) => {
    let opts = q.opts;
    // Có dấu * ở đầu = đáp án đúng
    let starIdx = opts.findIndex(o => /^\s*\*/.test(o.text));
    opts = opts.map(o => ({ ...o, text: o.text.replace(/^\s*\*\s*/, '') }));
    // Nhiều hơn 4 dòng: các dòng đầu (trích dẫn/mệnh đề) thuộc về câu hỏi
    let content = q.content;
    if (opts.length > 4) {
      const extra = opts.length - 4;
      content += '\n' + opts.slice(0, extra).map(o => o.text).join('\n');
      opts = opts.slice(extra);
      if (starIdx >= 0) starIdx -= extra;
    }
    let correct = q.answerLine ?? (starIdx >= 0 ? starIdx : pickCorrectByFormat(opts));
    if (correct >= opts.length) correct = -1;
    const options = opts.map(o => stripOptPrefix(o.text));
    if (options.length < 2) warnings.push(`Câu ${qi + 1}: chỉ có ${options.length} phương án`);
    if (correct < 0) warnings.push(`Câu ${qi + 1}: chưa xác định được đáp án đúng`);
    return { content: content.trim(), options, correct, explanation: '' };
  });
  return { questions: questions.filter(q => q.content && q.options.length >= 2), warnings };
}

export async function parseDocx(file) {
  const { default: JSZip } = await import('https://esm.sh/jszip@3.10.1');
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file('word/document.xml').async('string');
  return finalize(buildQuestions(readParagraphs(xml)));
}

// ---------------------------------------------------------------- TEXT (AIKEN mở rộng)
export function parseText(text) {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const raw = [];
  let cur = null;
  for (const line of lines) {
    const ans = line.match(RE_ANSWER_LINE);
    if (ans && cur) { cur.answerLine = letterToIdx(ans[1]); continue; }
    if (RE_OPTION_PREFIX.test(line) || /^\s*\*\s*[A-Fa-f]\s*[.)]/.test(line)) {
      if (cur) cur.opts.push({ text: line.replace(/^\s*\*\s*/, '*') });
      continue;
    }
    if (cur && cur.opts.length === 0) { cur.content += '\n' + line; continue; }
    if (cur) raw.push(cur);
    cur = { content: line.replace(RE_QUESTION, ''), opts: [] };
  }
  if (cur) raw.push(cur);
  return finalize(raw);
}

// ---------------------------------------------------------------- EXCEL / CSV
export async function parseSheet(file) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const wb = XLSX.read(await file.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    .map(r => r.map(c => clean(String(c))));
  if (!rows.length) return { questions: [], warnings: ['File trống'] };

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const header = rows[0].map(norm);
  const find = (...keys) => header.findIndex(h => keys.some(k => h === k || h.startsWith(k)));
  let iQ = find('cau hoi', 'noi dung', 'question'), iAns = find('dap an', 'answer', 'correct'),
      iExp = find('giai thich', 'explanation');
  let optCols = ['a', 'b', 'c', 'd', 'e', 'f'].map(k => header.findIndex(h => h === k || h === 'dap an ' + k || h === 'phuong an ' + k)).filter(i => i >= 0);
  let body = rows.slice(1);
  if (iQ < 0 || optCols.length < 2) {
    // Không có tiêu đề -> mặc định: Câu hỏi | A | B | C | D | Đáp án | Giải thích
    iQ = 0; optCols = [1, 2, 3, 4]; iAns = 5; iExp = 6; body = rows;
  }
  const warnings = [];
  const questions = [];
  body.forEach((r, i) => {
    const content = r[iQ];
    if (!content) return;
    const options = optCols.map(c => r[c] || '').filter(Boolean);
    const a = iAns >= 0 ? r[iAns] : '';
    let correct = a ? letterToIdx(a.trim()[0]) : -1;
    if (correct < 0 || correct >= options.length) { correct = -1; warnings.push(`Dòng ${i + 2}: chưa có đáp án hợp lệ`); }
    questions.push({ content: content.replace(RE_QUESTION, ''), options, correct, explanation: iExp >= 0 ? (r[iExp] || '') : '' });
  });
  return { questions, warnings };
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return parseDocx(file);
  if (/\.(xlsx|xls|csv)$/.test(name)) return parseSheet(file);
  if (name.endsWith('.txt')) return parseText(await file.text());
  throw new Error('Định dạng chưa hỗ trợ. Dùng .docx, .xlsx, .csv hoặc .txt');
}

export async function downloadExcelTemplate() {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const ws = XLSX.utils.aoa_to_sheet([
    ['Câu hỏi', 'A', 'B', 'C', 'D', 'Đáp án', 'Giải thích'],
    ['Thủ đô của Việt Nam là?', 'Hà Nội', 'Huế', 'Đà Nẵng', 'TP.HCM', 'A', 'Hà Nội là thủ đô từ 1010.'],
    ['2 + 2 = ?', '3', '4', '5', '6', 'B', ''],
  ]);
  ws['!cols'] = [{ wch: 50 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CauHoi');
  XLSX.writeFile(wb, 'mau-cau-hoi.xlsx');
}
