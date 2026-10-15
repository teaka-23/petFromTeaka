alter table public.chat_messages
  add column sender_type text not null default 'user'
  check (sender_type in ('user', 'bot'));

update public.chat_messages set sender_type = 'bot' where telegram_username like '%_bot';

create table public.memes (
  id bigint generated always as identity primary key,
  file_id text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.meme_sends (
  chat_id text not null,
  meme_id bigint not null references public.memes(id),
  sent_at timestamptz not null default now(),
  primary key (chat_id, meme_id)
);

alter table public.chat_messages enable row level security;
alter table public.memes enable row level security;
alter table public.meme_sends enable row level security;

drop policy if exists chat_messages_anon_insert on public.chat_messages;

create policy chat_messages_anon_insert
  on public.chat_messages for insert
  to anon, authenticated
  with check (true);

create policy chat_messages_anon_select
  on public.chat_messages for select
  to anon, authenticated
  using (true);

create policy memes_anon_all
  on public.memes for all
  to anon, authenticated
  using (true)
  with check (true);

create policy meme_sends_anon_all
  on public.meme_sends for all
  to anon, authenticated
  using (true)
  with check (true);
