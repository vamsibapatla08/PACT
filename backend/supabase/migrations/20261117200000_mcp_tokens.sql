-- Personal access tokens for the Pact MCP server, so Grok (or any MCP client) can act for someone.
-- Only a SHA-256 hash is stored; the token itself is shown once, when it's made. Each person can see and
-- revoke their own tokens. The MCP server looks a token up with the service role and then acts as that person,
-- so every existing row level security rule still applies to what Grok can do.

create table public.pact_mcp_tokens (
    token_id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    label text not null default 'Grok' check (char_length(btrim(label)) between 1 and 40),
    token_hash text not null unique,
    token_hint text not null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index pact_mcp_tokens_user_idx on public.pact_mcp_tokens (user_id, created_at desc);

alter table public.pact_mcp_tokens enable row level security;
revoke all on table public.pact_mcp_tokens from public, anon, authenticated;
grant select on table public.pact_mcp_tokens to authenticated;

create policy "People see their own MCP tokens"
on public.pact_mcp_tokens for select to authenticated
using (user_id = (select auth.uid()));

-- Makes a token and returns it once. Up to 10 live tokens each.
create or replace function public.create_mcp_token(p_label text default 'Grok')
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    token text;
begin
    if caller is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;
    if (select count(*) from public.pact_mcp_tokens where user_id = caller and revoked_at is null) >= 10 then
        raise exception 'You already have 10 tokens. Revoke one first.';
    end if;
    token := 'pact_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.pact_mcp_tokens (user_id, label, token_hash, token_hint)
    values (caller, coalesce(nullif(btrim(p_label), ''), 'Grok'),
            encode(sha256(convert_to(token, 'UTF8')), 'hex'), right(token, 4));
    return token;
end;
$$;

create or replace function public.revoke_mcp_token(p_token_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
    update public.pact_mcp_tokens set revoked_at = now()
    where token_id = p_token_id and user_id = auth.uid() and revoked_at is null;
$$;

revoke all on function public.create_mcp_token(text) from public, anon;
revoke all on function public.revoke_mcp_token(uuid) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;
grant execute on function public.revoke_mcp_token(uuid) to authenticated;
