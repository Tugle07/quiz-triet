-- =====================================================================
-- QuizHub - Supabase schema
-- Chạy toàn bộ file này trong Supabase Dashboard > SQL Editor > New query
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Bảng ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  subject text default '',
  duration_min int,                       -- null = không giới hạn
  mode text not null default 'exam' check (mode in ('exam','practice')),
  question_count int,                     -- null = dùng toàn bộ câu; n = random n câu
  shuffle_questions boolean not null default true,
  shuffle_options boolean not null default true,
  show_answers boolean not null default true,  -- cho xem đáp án sau khi nộp
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  position int not null default 0,
  content text not null,
  options jsonb not null,                 -- mảng chuỗi
  correct int not null,                   -- index đáp án đúng (0-based)
  explanation text default ''
);
create index if not exists questions_test_idx on public.questions(test_id, position);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  student_name text not null,
  score int not null,
  total int not null,
  answers jsonb not null,                 -- { question_id: chosen_index }
  started_at timestamptz,
  submitted_at timestamptz not null default now(),
  duration_sec int
);
create index if not exists attempts_test_idx on public.attempts(test_id, submitted_at desc);

-- ---------- Helper ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- RLS ----------
alter table public.admins    enable row level security;
alter table public.tests     enable row level security;
alter table public.questions enable row level security;
alter table public.attempts  enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (user_id = auth.uid());

drop policy if exists tests_public_read on public.tests;
create policy tests_public_read on public.tests for select using (published or public.is_admin());
drop policy if exists tests_admin_all on public.tests;
create policy tests_admin_all on public.tests for all using (public.is_admin()) with check (public.is_admin());

-- Học viên KHÔNG đọc trực tiếp bảng questions/attempts (chỉ qua RPC bên dưới)
drop policy if exists questions_admin_all on public.questions;
create policy questions_admin_all on public.questions for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists attempts_admin_all on public.attempts;
create policy attempts_admin_all on public.attempts for all using (public.is_admin()) with check (public.is_admin());

-- ---------- RPC cho học viên ----------

-- Danh sách bài thi công khai kèm số câu
create or replace function public.list_tests()
returns table (id uuid, title text, description text, subject text, duration_min int,
               mode text, num_questions int, attempts_count bigint, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.description, t.subject, t.duration_min, t.mode,
         coalesce(least(t.question_count, q.cnt), q.cnt)::int,
         (select count(*) from attempts a where a.test_id = t.id),
         t.created_at
  from tests t
  join lateral (select count(*)::int cnt from questions where test_id = t.id) q on true
  where t.published and q.cnt > 0
  order by t.created_at desc;
$$;

-- Lấy đề (KHÔNG kèm đáp án)
create or replace function public.get_test(p_test_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t tests; qs jsonb;
begin
  select * into t from tests where id = p_test_id and published;
  if not found then raise exception 'Bài thi không tồn tại hoặc chưa mở'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'content', x.content, 'options', x.options)
                            order by x.ord), '[]'::jsonb)
  into qs
  from (
    select q.id, q.content, q.options,
           case when t.shuffle_questions or t.question_count is not null then random() else q.position end as ord
    from questions q where q.test_id = t.id
    order by ord
    limit coalesce(t.question_count, 100000)
  ) x;

  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'description', t.description, 'subject', t.subject,
    'duration_min', t.duration_min, 'mode', t.mode,
    'shuffle_questions', t.shuffle_questions, 'shuffle_options', t.shuffle_options,
    'questions', qs);
end $$;

-- Kiểm tra 1 câu (chỉ cho chế độ luyện tập)
create or replace function public.check_answer(p_question_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select q.correct, q.explanation, t.mode into r
  from questions q join tests t on t.id = q.test_id
  where q.id = p_question_id and t.published;
  if not found or r.mode <> 'practice' then raise exception 'Không được phép'; end if;
  return jsonb_build_object('correct', r.correct, 'explanation', r.explanation);
end $$;

-- Nộp bài & chấm điểm
create or replace function public.submit_attempt(p_test_id uuid, p_name text, p_answers jsonb,
                                                 p_question_ids uuid[], p_started_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t tests; v_score int := 0; v_total int; v_review jsonb; v_id uuid; v_name text;
begin
  select * into t from tests where id = p_test_id and published;
  if not found then raise exception 'Bài thi không tồn tại hoặc đã đóng'; end if;

  v_name := left(trim(coalesce(p_name, '')), 60);
  if v_name = '' then raise exception 'Vui lòng nhập tên'; end if;

  v_total := coalesce(array_length(p_question_ids, 1), 0);
  if v_total = 0 then raise exception 'Không có câu hỏi'; end if;

  select count(*) into v_score
  from questions q
  where q.test_id = t.id and q.id = any(p_question_ids)
    and (p_answers ->> q.id::text) is not null
    and (p_answers ->> q.id::text)::int = q.correct;

  insert into attempts (test_id, student_name, score, total, answers, started_at, duration_sec)
  values (t.id, v_name, v_score, v_total, coalesce(p_answers, '{}'::jsonb), p_started_at,
          greatest(0, extract(epoch from (now() - coalesce(p_started_at, now())))::int))
  returning id into v_id;

  if t.show_answers or t.mode = 'practice' then
    select jsonb_object_agg(q.id::text, jsonb_build_object('correct', q.correct, 'explanation', q.explanation))
    into v_review
    from questions q where q.test_id = t.id and q.id = any(p_question_ids);
  end if;

  return jsonb_build_object('attempt_id', v_id, 'score', v_score, 'total', v_total, 'review', v_review);
end $$;

-- Bảng xếp hạng (top 10 điểm cao nhất mỗi bài)
create or replace function public.leaderboard(p_test_id uuid)
returns table (student_name text, score int, total int, duration_sec int, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.student_name, a.score, a.total, a.duration_sec, a.submitted_at
  from attempts a join tests t on t.id = a.test_id
  where a.test_id = p_test_id and t.published
  order by (a.score::float / nullif(a.total, 0)) desc, a.duration_sec asc nulls last
  limit 10;
$$;

grant execute on function public.list_tests() to anon, authenticated;
grant execute on function public.get_test(uuid) to anon, authenticated;
grant execute on function public.check_answer(uuid) to anon, authenticated;
grant execute on function public.submit_attempt(uuid, text, jsonb, uuid[], timestamptz) to anon, authenticated;
grant execute on function public.leaderboard(uuid) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- =====================================================================
-- SAU KHI tạo tài khoản admin (Authentication > Users > Add user),
-- chạy dòng sau (thay email của bạn) để cấp quyền admin:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'email-cua-ban@gmail.com';
-- =====================================================================
