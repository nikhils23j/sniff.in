-- Pin search_path on the remaining (SECURITY INVOKER) helper functions, per Supabase Security Advisor
-- lint 0011. These only use pg_catalog built-ins and schema-qualified references.
alter function app_private.fail(text, text) set search_path = pg_catalog, pg_temp;
alter function app_private.touch_updated_at() set search_path = pg_catalog, pg_temp;
alter function app_private.available_bucket(bigint) set search_path = pg_catalog, pg_temp;
alter function app_private.normalize_token(text) set search_path = pg_catalog, pg_temp;
alter function app_private.random_code(integer) set search_path = pg_catalog, pg_temp;
alter function app_private.connection_requests_transition() set search_path = pg_catalog, pg_temp;
alter function app_private.profile_private_validate() set search_path = pg_catalog, pg_temp;
alter function app_private.servers_policy_check() set search_path = pg_catalog, pg_temp;
