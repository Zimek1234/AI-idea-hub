begin;
-- One implicit room per workspace. Composite keys prevent cross-workspace references.
alter table public.entries add constraint entries_workspace_id_id_key unique(workspace_id,id);
create table public.chat_messages (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 author_id uuid not null default auth.uid() references auth.users(id),
 author_name text not null default '',
 body text not null default '' check(length(body)<=3000),
 created_at timestamptz not null default now(),
 reply_to uuid, shared_entry_id uuid,
 unique(workspace_id,id),
 check(length(trim(body))>0 or shared_entry_id is not null),
 check(reply_to is null or reply_to<>id),
 foreign key(workspace_id,reply_to) references public.chat_messages(workspace_id,id),
 foreign key(workspace_id,shared_entry_id) references public.entries(workspace_id,id)
);
create index chat_messages_history on public.chat_messages(workspace_id,created_at desc,id desc);
create table public.chat_reactions (
 workspace_id uuid not null,
 message_id uuid not null,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 emoji text not null check(emoji in ('👍','❤️','🎉','🚀','👀','💡')),
 active boolean not null default true,
 primary key(message_id,user_id,emoji),
 foreign key(workspace_id,message_id) references public.chat_messages(workspace_id,id) on delete cascade
);
-- Soft toggles keep workspace_id on every Realtime event (DELETE events cannot be filtered).
create table public.chat_reads (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 read_at timestamptz not null,
 primary key(workspace_id,user_id)
);
create function public.prepare_chat_message() returns trigger language plpgsql set search_path='' as $$
begin
 new.body=trim(new.body);
 if new.body ~ '^[[:space:]]*$' and new.shared_entry_id is null then raise exception 'Message cannot be blank'; end if;
 -- The server owns timestamps, even when an API caller supplies one.
 new.created_at=clock_timestamp();
 select email into new.author_name from public.workspace_members where workspace_id=new.workspace_id and user_id=auth.uid();
 new.author_name=coalesce(new.author_name,'Workspace member'); -- RLS rejects non-members below.
 if new.shared_entry_id is not null and not exists(select 1 from public.entries where id=new.shared_entry_id and workspace_id=new.workspace_id and section='library') then
  raise exception 'Share an accessible AI Library entry';
 end if;
 return new;
end $$;
create trigger prepare_chat_message before insert on public.chat_messages for each row execute function public.prepare_chat_message();
create function public.protect_chat_reaction() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.workspace_id,new.message_id,new.user_id,new.emoji) is distinct from (old.workspace_id,old.message_id,old.user_id,old.emoji) then raise exception 'Reaction identity is immutable'; end if;
 return new;
end $$;
create trigger protect_chat_reaction before update on public.chat_reactions for each row execute function public.protect_chat_reaction();
alter table public.chat_messages enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_reads enable row level security;
create policy chat_message_read on public.chat_messages for select to authenticated using(public.is_workspace_member(workspace_id));
create policy chat_message_insert on public.chat_messages for insert to authenticated with check(public.is_workspace_member(workspace_id) and author_id=auth.uid());
create policy chat_reaction_read on public.chat_reactions for select to authenticated using(public.is_workspace_member(workspace_id));
create policy chat_reaction_insert on public.chat_reactions for insert to authenticated with check(public.is_workspace_member(workspace_id) and user_id=auth.uid());
create policy chat_reaction_update on public.chat_reactions for update to authenticated using(public.is_workspace_member(workspace_id) and user_id=auth.uid()) with check(public.is_workspace_member(workspace_id) and user_id=auth.uid());
create policy chat_read_select on public.chat_reads for select to authenticated using(public.is_workspace_member(workspace_id) and user_id=auth.uid());
create policy chat_read_insert on public.chat_reads for insert to authenticated with check(public.is_workspace_member(workspace_id) and user_id=auth.uid() and read_at<=clock_timestamp());
create policy chat_read_update on public.chat_reads for update to authenticated using(public.is_workspace_member(workspace_id) and user_id=auth.uid()) with check(public.is_workspace_member(workspace_id) and user_id=auth.uid() and read_at<=clock_timestamp());
-- Resolve the cursor against a visible message; never trust a browser's clock.
create function public.mark_chat_read(wid uuid,last_message_id uuid) returns void language sql security invoker set search_path='' as $$
 insert into public.chat_reads(workspace_id,user_id,read_at)
 select wid,auth.uid(),m.created_at from public.chat_messages m where m.id=last_message_id and m.workspace_id=wid
 on conflict(workspace_id,user_id) do update set read_at=greatest(public.chat_reads.read_at,excluded.read_at);
$$;
revoke all on public.chat_messages,public.chat_reactions,public.chat_reads from public,anon,authenticated;
grant select,insert on public.chat_messages to authenticated;
grant select,insert,update on public.chat_reactions,public.chat_reads to authenticated;
revoke all on function public.prepare_chat_message(),public.protect_chat_reaction(),public.mark_chat_read(uuid,uuid) from public,anon;
grant execute on function public.mark_chat_read(uuid,uuid) to authenticated;
-- This only takes effect when an administrator applies this migration; no infrastructure is changed by authoring it.
do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.chat_messages,public.chat_reactions,public.chat_reads;
 end if;
end $$;
commit;
