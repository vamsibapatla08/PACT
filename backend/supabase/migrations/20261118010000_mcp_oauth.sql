-- "Continue with Google" for the Pact MCP server. Grok (or any MCP client) registers itself, sends the person to
-- Pact to sign in with Google and approve, then swaps a one-time code for a normal pact_ token. The token lands in
-- pact_mcp_tokens like a hand-made one, so it shows on the Connect Grok page and can be revoked there.
-- Only the pact-mcp function (service role) touches the clients and codes directly. The browser only gets two
-- functions: read a pending request, and approve it as the signed-in person.

create table public.pact_mcp_oauth_clients (
    client_id text primary key,
    client_name text not null default 'Grok' check (char_length(client_name) between 1 and 80),
    redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
    created_at timestamptz not null default now()
);

create table public.pact_mcp_oauth_requests (
    request_id uuid primary key default gen_random_uuid(),
    client_id text not null references public.pact_mcp_oauth_clients(client_id) on delete cascade,
    redirect_uri text not null,
    state text,
    code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '15 minutes',
    user_id uuid references auth.users(id) on delete cascade,
    code_hash text unique,
    approved_at timestamptz,
    used_at timestamptz
);

create index pact_mcp_oauth_requests_created_idx on public.pact_mcp_oauth_requests (created_at);

alter table public.pact_mcp_oauth_clients enable row level security;
alter table public.pact_mcp_oauth_requests enable row level security;
revoke all on table public.pact_mcp_oauth_clients from public, anon, authenticated;
revoke all on table public.pact_mcp_oauth_requests from public, anon, authenticated;
-- No policies: nobody but the service role reads or writes these tables.

-- What the approve page shows: which app is asking and where it sends you back to.
create or replace function public.get_mcp_authorization(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'client_name', c.client_name,
        'redirect_uri', r.redirect_uri,
        'state', r.state,
        'expired', r.expires_at < now() or r.approved_at is not null
    )
    from public.pact_mcp_oauth_requests r
    join public.pact_mcp_oauth_clients c using (client_id)
    where r.request_id = p_request_id and auth.uid() is not null;
$$;

-- The signed-in person says yes. Returns a one-time code (valid 5 minutes) for the app to hand back to the client.
create or replace function public.approve_mcp_authorization(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    req public.pact_mcp_oauth_requests;
    code text;
begin
    if caller is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;
    select * into req from public.pact_mcp_oauth_requests where request_id = p_request_id for update;
    if req.request_id is null or req.expires_at < now() or req.approved_at is not null then
        raise exception 'This connect link has expired. Start again from Grok.';
    end if;
    if (select count(*) from public.pact_mcp_tokens where user_id = caller and revoked_at is null) >= 10 then
        raise exception 'You already have 10 connections. Revoke one on the Connect Grok page first.';
    end if;
    code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.pact_mcp_oauth_requests
    set user_id = caller, approved_at = now(), expires_at = now() + interval '5 minutes',
        code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex')
    where request_id = p_request_id;
    return jsonb_build_object('redirect_uri', req.redirect_uri, 'code', code, 'state', req.state);
end;
$$;

revoke all on function public.get_mcp_authorization(uuid) from public, anon;
revoke all on function public.approve_mcp_authorization(uuid) from public, anon;
grant execute on function public.get_mcp_authorization(uuid) to authenticated;
grant execute on function public.approve_mcp_authorization(uuid) to authenticated;
