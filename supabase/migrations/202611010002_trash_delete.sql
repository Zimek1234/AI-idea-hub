begin;
-- Members may permanently delete only entries that are still in Trash at execution time.
grant delete on public.entries to authenticated;
create policy entry_delete_trash on public.entries for delete to authenticated
 using(status='Trash' and public.is_workspace_member(workspace_id));

-- Deleting an entry already cascades to personal feedback and comments. Keep chat
-- history instead: detach its card reference and show a tombstone. Without this,
-- the original FK blocks deletion of shared entries, and tool-only messages would
-- violate the original non-empty constraint when their reference becomes NULL.
alter table public.chat_messages add column shared_entry_deleted boolean not null default false;
alter table public.chat_messages drop constraint chat_messages_check;
alter table public.chat_messages add constraint chat_messages_content_check
 check(length(trim(body))>0 or shared_entry_id is not null or shared_entry_deleted);
alter table public.chat_messages drop constraint chat_messages_workspace_id_shared_entry_id_fkey;
alter table public.chat_messages add constraint chat_messages_workspace_id_shared_entry_id_fkey
 foreign key(workspace_id,shared_entry_id) references public.entries(workspace_id,id)
 on delete set null (shared_entry_id);

create function public.track_chat_entry_deletion() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then new.shared_entry_deleted=false;
 elsif old.shared_entry_id is not null and new.shared_entry_id is null then new.shared_entry_deleted=true;
 else new.shared_entry_deleted=old.shared_entry_deleted;
 end if;
 return new;
end $$;
create trigger track_chat_entry_deletion before insert or update on public.chat_messages
 for each row execute function public.track_chat_entry_deletion();
revoke all on function public.track_chat_entry_deletion() from public,anon,authenticated;
-- Ask PostgREST to reload the changed FK metadata; no RLS or Realtime bypass.
notify pgrst, 'reload schema';
commit;
