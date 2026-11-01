begin;
-- Keep the existing trigger, permissions, timestamps, and author protection.
-- Only broaden the shareable section: both library and ideas are valid entries.
create or replace function public.prepare_chat_message() returns trigger language plpgsql set search_path='' as $$
begin
 new.body=trim(new.body);
 if new.body ~ '^[[:space:]]*$' and new.shared_entry_id is null then raise exception 'Message cannot be blank'; end if;
 new.created_at=clock_timestamp();
 select email into new.author_name from public.workspace_members where workspace_id=new.workspace_id and user_id=auth.uid();
 new.author_name=coalesce(new.author_name,'Workspace member');
 if new.shared_entry_id is not null and not exists(select 1 from public.entries where id=new.shared_entry_id and workspace_id=new.workspace_id) then
  raise exception 'Share an accessible Idea Hub entry';
 end if;
 return new;
end $$;
-- The composite FK still enforces (workspace_id, shared_entry_id), and existing
-- RLS still requires membership and author_id=auth.uid(). No history is rewritten.
commit;
