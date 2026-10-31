begin;
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 80),
 owner_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.workspace_members (
 workspace_id uuid references public.workspaces(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade,
 email text not null, primary key(workspace_id,user_id)
);
create table public.workspace_invites (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 expires_at timestamptz not null default now() + interval '7 days', unique(workspace_id,email)
);
create function public.is_workspace_member(wid uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.workspace_members where workspace_id=wid and user_id=auth.uid());
$$;
create table public.entries (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 author_id uuid not null default auth.uid() references auth.users(id),
 title text not null check(length(trim(title)) between 1 and 160), description text not null default '' check(length(description)<=3000),
 source_url text check(source_url is null or (length(source_url)<=2000 and source_url ~ '^https?://[^/@[:space:]]+(\.[^/@[:space:]]+|:[0-9]+)?([/?][^[:space:]]*)?$' and source_url !~ '^https?://[^/]*@')),
 category text not null check(category in ('Tool','Agent','Skill','Prompt','Workflow','Automation')),
 tags text[] not null default '{}' check(cardinality(tags)<=12 and array_position(tags,null) is null),
 notes text not null default '' check(length(notes)<=10000), status text not null default 'To Try' check(status in ('To Try','Testing','Using','Trash')),
 section text not null default 'library' check(section in ('library','ideas')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index entries_title_unique on public.entries(workspace_id,lower(trim(title)));
create unique index entries_url_unique on public.entries(workspace_id,source_url) where source_url is not null;
create index entries_workspace_created on public.entries(workspace_id,created_at desc);
create table public.entry_feedback (
 entry_id uuid references public.entries(id) on delete cascade, user_id uuid default auth.uid() references auth.users(id) on delete cascade,
 rating integer check(rating between 1 and 5), notes text not null default '' check(length(notes)<=10000),
 primary key(entry_id,user_id)
);
create table public.comments (
 id uuid primary key default gen_random_uuid(), entry_id uuid not null references public.entries(id) on delete cascade,
 author_id uuid not null default auth.uid() references auth.users(id), body text not null check(length(trim(body)) between 1 and 3000),
 created_at timestamptz not null default now()
);
create index comments_entry on public.comments(entry_id,created_at);
create function public.protect_entry() returns trigger language plpgsql set search_path = '' as $$
begin
 if TG_OP='UPDATE' and (new.id<>old.id or new.workspace_id<>old.workspace_id or new.author_id<>old.author_id or new.created_at<>old.created_at) then raise exception 'Entry identity is immutable'; end if;
 if exists(select 1 from unnest(new.tags) t where length(trim(t)) not between 1 and 32) then raise exception 'Invalid tag'; end if;
 new.updated_at=now(); return new;
end $$;
create trigger protect_entry before insert or update on public.entries for each row execute function public.protect_entry();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.entries enable row level security;
alter table public.entry_feedback enable row level security;
alter table public.comments enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(public.is_workspace_member(id));
create policy member_read on public.workspace_members for select to authenticated using(public.is_workspace_member(workspace_id));
create policy invite_owner_read on public.workspace_invites for select to authenticated using(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=auth.uid()));
create policy entry_read on public.entries for select to authenticated using(public.is_workspace_member(workspace_id));
create policy entry_insert on public.entries for insert to authenticated with check(public.is_workspace_member(workspace_id) and author_id=auth.uid());
create policy entry_update on public.entries for update to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
-- Personal notes and ratings are private to their author; comments are shared.
create policy feedback_read on public.entry_feedback for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.entries e where e.id=entry_id));
create policy feedback_insert on public.entry_feedback for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.entries e where e.id=entry_id));
create policy feedback_update on public.entry_feedback for update to authenticated using(user_id=auth.uid() and exists(select 1 from public.entries e where e.id=entry_id)) with check(user_id=auth.uid() and exists(select 1 from public.entries e where e.id=entry_id));
create policy comment_read on public.comments for select to authenticated using(exists(select 1 from public.entries e where e.id=entry_id));
create policy comment_insert on public.comments for insert to authenticated with check(author_id=auth.uid() and exists(select 1 from public.entries e where e.id=entry_id));
create policy comment_delete on public.comments for delete to authenticated using(author_id=auth.uid() and exists(select 1 from public.entries e where e.id=entry_id));

create function public.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare wid uuid; user_email text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select email into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if user_email is null then raise exception 'Verified email required'; end if;
 insert into public.workspaces(name,owner_id) values(trim(workspace_name),auth.uid()) returning id into wid;
 insert into public.workspace_members values(wid,auth.uid(),user_email); return wid;
end $$;
create function public.invite_member(wid uuid, invite_email text) returns void language plpgsql security definer set search_path = '' as $$
declare seats integer;
begin
 perform 1 from public.workspaces where id=wid and owner_id=auth.uid() for update;
 if not found then raise exception 'Workspace owner required'; end if;
 delete from public.workspace_invites where workspace_id=wid and expires_at<now();
 if exists(select 1 from public.workspace_members where workspace_id=wid and lower(email)=lower(trim(invite_email))) then raise exception 'Already a member'; end if;
 select (select count(*) from public.workspace_members where workspace_id=wid)+(select count(*) from public.workspace_invites where workspace_id=wid and email<>lower(trim(invite_email))) into seats;
 if seats>=5 then raise exception 'A workspace supports up to 5 people, including pending invitations'; end if;
 insert into public.workspace_invites(workspace_id,email) values(wid,lower(trim(invite_email))) on conflict(workspace_id,email) do update set expires_at=now()+interval '7 days';
end $$;
create function public.accept_invites() returns void language plpgsql security definer set search_path = '' as $$
declare invitation record; user_email text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select lower(email) into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 for invitation in select * from public.workspace_invites where email=user_email and expires_at>now() order by workspace_id loop
  perform 1 from public.workspaces where id=invitation.workspace_id for update;
  if exists(select 1 from public.workspace_invites where id=invitation.id and email=user_email and expires_at>now()) and (select count(*) from public.workspace_members where workspace_id=invitation.workspace_id)<5 then
   insert into public.workspace_members values(invitation.workspace_id,auth.uid(),user_email) on conflict do nothing;
   delete from public.workspace_invites where id=invitation.id;
  end if;
 end loop;
end $$;
create function public.remove_member(wid uuid, member_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.workspaces where id=wid and owner_id=auth.uid() and owner_id<>member_id for update;
 if not found then raise exception 'Only an owner can remove another member'; end if;
 delete from public.workspace_members where workspace_id=wid and user_id=member_id;
end $$;
create function public.revoke_invite(invite_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
 delete from public.workspace_invites i where i.id=invite_id and exists(select 1 from public.workspaces w where w.id=i.workspace_id and w.owner_id=auth.uid());
 if not found then raise exception 'Invitation not found or not allowed'; end if;
end $$;
revoke all on public.workspaces,public.workspace_members,public.workspace_invites,public.entries,public.entry_feedback,public.comments from anon,authenticated;
grant select on public.workspaces,public.workspace_members,public.workspace_invites to authenticated;
grant select,insert,update on public.entries,public.entry_feedback to authenticated;
grant select,insert,delete on public.comments to authenticated;
revoke all on function public.is_workspace_member(uuid),public.create_workspace(text),public.invite_member(uuid,text),public.accept_invites(),public.remove_member(uuid,uuid),public.revoke_invite(uuid),public.protect_entry() from public,anon;
grant execute on function public.is_workspace_member(uuid),public.create_workspace(text),public.invite_member(uuid,text),public.accept_invites(),public.remove_member(uuid,uuid),public.revoke_invite(uuid) to authenticated;
create function public.search_entries(wid uuid, query_text text) returns setof public.entries language sql stable security invoker set search_path = '' as $$
 select e.* from public.entries e where e.workspace_id=wid and length(trim(query_text)) between 1 and 200
 and strpos(lower(concat_ws(' ',e.title,e.description,e.source_url,array_to_string(e.tags,' '))),lower(trim(query_text)))>0;
$$;
revoke all on function public.search_entries(uuid,text) from public,anon;
grant execute on function public.search_entries(uuid,text) to authenticated;
commit;
