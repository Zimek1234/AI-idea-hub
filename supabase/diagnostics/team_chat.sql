-- READ ONLY: metadata only, no customer messages or database changes.
select current_database() as database_name, current_setting('server_version') as postgres_version;
select name, to_regclass('public.' || name) as relation
from (values ('workspace_members'),('entries'),('chat_messages'),('chat_reactions'),('chat_reads')) as expected(name);
select table_name,
 has_table_privilege('authenticated','public.' || table_name,'SELECT') as member_can_select,
 has_table_privilege('authenticated','public.' || table_name,'INSERT') as member_can_insert,
 has_table_privilege('authenticated','public.' || table_name,'UPDATE') as member_can_update,
 has_table_privilege('authenticated','public.' || table_name,'DELETE') as member_can_delete
from information_schema.tables
where table_schema='public' and table_name in ('entries','workspace_members','chat_messages','chat_reactions','chat_reads');
select c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('entries','chat_messages','chat_reactions','chat_reads');
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('entries','workspace_members','chat_messages','chat_reactions','chat_reads')
order by tablename,policyname;
select pubname,tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public'
and tablename in ('chat_messages','chat_reactions','chat_reads');
select conname,pg_get_constraintdef(oid) as definition from pg_constraint
where conrelid=to_regclass('public.chat_messages') and contype='f';
select p.proname,p.prosecdef as security_definer,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as member_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('mark_chat_read','is_workspace_member');
