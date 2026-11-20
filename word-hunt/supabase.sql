-- Word Hunt MVP database. Run this in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.wh_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  host_id text not null,
  host_name text not null,
  guesser_id text,
  guesser_name text,
  status text not null default 'waiting' check (status in ('waiting','active','won','lost')),
  created_at timestamptz not null default now()
);
create table if not exists public.wh_secrets (
  room_id uuid primary key references public.wh_rooms(id) on delete cascade,
  secret_word text not null check (secret_word ~ '^[A-Z]{5}$')
);
create table if not exists public.wh_guesses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.wh_rooms(id) on delete cascade,
  guess_number int not null check (guess_number between 1 and 5),
  word text not null check (word ~ '^[A-Z]{5}$'),
  marks text[] check (marks is null or (array_length(marks,1)=5 and marks <@ array['correct','present','absent']::text[])),
  created_at timestamptz not null default now(),
  unique(room_id, guess_number)
);
alter table public.wh_rooms enable row level security;
alter table public.wh_secrets enable row level security;
alter table public.wh_guesses enable row level security;
-- No direct table access: all reads/writes go through the guarded RPC functions below.
revoke all on public.wh_rooms, public.wh_secrets, public.wh_guesses from anon, authenticated;
grant usage on schema public to anon, authenticated;

create or replace function public.wh_create_room(p_player_id text, p_player_name text, p_secret_word text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.wh_rooms; code text;
begin
 if length(trim(p_player_name)) not between 1 and 24 or upper(p_secret_word) !~ '^[A-Z]{5}$' then raise exception 'Enter a name and a five-letter word'; end if;
 loop code := upper(substr(encode(gen_random_bytes(5),'hex'),1,6)); exit when not exists(select 1 from wh_rooms where room_code=code); end loop;
 insert into wh_rooms(room_code,host_id,host_name) values(code,p_player_id,trim(p_player_name)) returning * into r;
 insert into wh_secrets(room_id,secret_word) values(r.id,upper(p_secret_word));
 return jsonb_build_object('id',r.id,'room_code',r.room_code,'host_name',r.host_name,'status',r.status,'secret_word',upper(p_secret_word),'guesses','[]'::jsonb);
end $$;

create or replace function public.wh_join_room(p_player_id text, p_player_name text, p_room_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r wh_rooms;
begin
 select * into r from wh_rooms where room_code=upper(p_room_code) for update;
 if not found then raise exception 'Room not found'; end if;
 if r.status <> 'waiting' then raise exception 'This room is no longer accepting players'; end if;
 if r.host_id=p_player_id then raise exception 'The host cannot join as the guesser'; end if;
 update wh_rooms set guesser_id=p_player_id, guesser_name=trim(p_player_name), status='active' where id=r.id returning * into r;
 return jsonb_build_object('id',r.id,'room_code',r.room_code,'host_name',r.host_name,'guesser_name',r.guesser_name,'status',r.status,'guesses','[]'::jsonb);
end $$;

create or replace function public.wh_get_game(p_player_id text, p_room_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r wh_rooms; s text; gs jsonb;
begin
 select * into r from wh_rooms where room_code=upper(p_room_code);
 if not found or p_player_id not in (r.host_id,coalesce(r.guesser_id,'!')) then raise exception 'Room not found or access denied'; end if;
 select jsonb_agg(jsonb_build_object('id',g.id,'word',g.word,'marks',g.marks,'guess_number',g.guess_number) order by g.guess_number) into gs from wh_guesses g where g.room_id=r.id;
 if r.host_id=p_player_id then select secret_word into s from wh_secrets where room_id=r.id; end if;
 return jsonb_build_object('id',r.id,'room_code',r.room_code,'host_name',r.host_name,'guesser_name',r.guesser_name,'status',r.status,'secret_word',s,'guesses',coalesce(gs,'[]'::jsonb));
end $$;

create or replace function public.wh_submit_guess(p_player_id text, p_room_code text, p_word text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r wh_rooms; n int; secret text;
begin
 select * into r from wh_rooms where room_code=upper(p_room_code) for update;
 if not found or r.guesser_id is distinct from p_player_id then raise exception 'Only Player 2 can submit guesses'; end if;
 if r.status <> 'active' then raise exception 'This game is not active'; end if;
 if upper(p_word) !~ '^[A-Z]{5}$' then raise exception 'Guess must be exactly five letters'; end if;
 if exists(select 1 from wh_guesses where room_id=r.id and marks is null) then raise exception 'Wait for Player 1 to mark the previous guess'; end if;
 select count(*)+1 into n from wh_guesses where room_id=r.id;
 if n>5 then raise exception 'No attempts remaining'; end if;
 insert into wh_guesses(room_id,guess_number,word) values(r.id,n,upper(p_word));
 select secret_word into secret from wh_secrets where room_id=r.id;
 if upper(p_word)=secret then update wh_rooms set status='won' where id=r.id;
 elsif n=5 then update wh_rooms set status='lost' where id=r.id; end if;
 return jsonb_build_object('ok',true,'attempt',n);
end $$;

create or replace function public.wh_mark_feedback(p_player_id text, p_room_code text, p_guess_id uuid, p_marks text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare r wh_rooms;
begin
 select * into r from wh_rooms where room_code=upper(p_room_code) for update;
 if not found or r.host_id is distinct from p_player_id then raise exception 'Only Player 1 can mark feedback'; end if;
 if array_length(p_marks,1)<>5 or not (p_marks <@ array['correct','present','absent']::text[]) then raise exception 'Invalid feedback'; end if;
 update wh_guesses set marks=p_marks where id=p_guess_id and room_id=r.id and marks is null;
 if not found then raise exception 'Guess not found or feedback already submitted'; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.wh_create_room(text,text,text), public.wh_join_room(text,text,text), public.wh_get_game(text,text), public.wh_submit_guess(text,text,text), public.wh_mark_feedback(text,text,uuid,text[]) from public;
grant execute on function public.wh_create_room(text,text,text), public.wh_join_room(text,text,text), public.wh_get_game(text,text), public.wh_submit_guess(text,text,text), public.wh_mark_feedback(text,text,uuid,text[]) to anon, authenticated;

-- Enable Realtime for the two tables the client listens to.
alter publication supabase_realtime add table public.wh_rooms;
alter publication supabase_realtime add table public.wh_guesses;
