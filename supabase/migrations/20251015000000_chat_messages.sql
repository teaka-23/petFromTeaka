create table public.chat_messages (
  id bigint generated always as identity primary key,
  telegram_username text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy chat_messages_anon_insert
  on public.chat_messages for insert
  to anon, authenticated
  with check (true);
