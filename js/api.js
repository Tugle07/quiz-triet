import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON');

export const sb = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Học viên ----------
export const listTests = () => rpc('list_tests');
export const getTest = (id) => rpc('get_test', { p_test_id: id });
export const checkAnswer = (qid) => rpc('check_answer', { p_question_id: qid });
export const leaderboard = (id) => rpc('leaderboard', { p_test_id: id });
export const submitAttempt = (testId, name, answers, questionIds, startedAt) =>
  rpc('submit_attempt', {
    p_test_id: testId, p_name: name, p_answers: answers,
    p_question_ids: questionIds, p_started_at: startedAt,
  });

// ---------- Admin ----------
function must({ data, error }) { if (error) throw new Error(error.message); return data; }

export async function login(email, password) {
  must(await sb.auth.signInWithPassword({ email, password }));
  if (!(await isAdmin())) { await sb.auth.signOut(); throw new Error('Tài khoản này không có quyền admin'); }
}
export const logout = () => sb.auth.signOut();
export async function isAdmin() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return false;
  return !!(await rpc('is_admin'));
}

export const adminListTests = async () =>
  must(await sb.from('tests').select('*, questions(count), attempts(count)').order('created_at', { ascending: false }));
export const adminGetTest = async (id) =>
  must(await sb.from('tests').select('*').eq('id', id).single());
export const adminGetQuestions = async (testId) =>
  must(await sb.from('questions').select('*').eq('test_id', testId).order('position'));
export const adminGetAttempts = async (testId) => {
  let q = sb.from('attempts').select('*, tests(title)').order('submitted_at', { ascending: false });
  if (testId) q = q.eq('test_id', testId);
  return must(await q.limit(2000));
};

export async function saveTest(test, questions) {
  const payload = { ...test }; delete payload.questions; delete payload.attempts;
  let saved;
  if (payload.id) saved = must(await sb.from('tests').update(payload).eq('id', payload.id).select().single());
  else { delete payload.id; saved = must(await sb.from('tests').insert(payload).select().single()); }

  if (questions) {
    // Xoá các câu không còn, upsert các câu còn lại
    const existing = must(await sb.from('questions').select('id').eq('test_id', saved.id)).map(r => r.id);
    const keep = new Set(questions.filter(q => q.id).map(q => q.id));
    const toDelete = existing.filter(id => !keep.has(id));
    if (toDelete.length) must(await sb.from('questions').delete().in('id', toDelete));

    const rows = questions.map((q, i) => ({
      ...(q.id ? { id: q.id } : {}),
      test_id: saved.id, position: i, content: q.content,
      options: q.options, correct: q.correct, explanation: q.explanation || '',
    }));
    const withId = rows.filter(r => r.id), noId = rows.filter(r => !r.id);
    for (let i = 0; i < withId.length; i += 200) must(await sb.from('questions').upsert(withId.slice(i, i + 200)));
    for (let i = 0; i < noId.length; i += 200) must(await sb.from('questions').insert(noId.slice(i, i + 200)));
  }
  return saved;
}

export const setPublished = async (id, published) =>
  must(await sb.from('tests').update({ published }).eq('id', id));
export const deleteTest = async (id) => must(await sb.from('tests').delete().eq('id', id));
export const deleteAttempt = async (id) => must(await sb.from('attempts').delete().eq('id', id));
