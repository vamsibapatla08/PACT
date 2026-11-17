begin;

alter table public.pact_messages
  add column if not exists action_card_id uuid references public.pact_action_cards(card_id) on delete set null;

create index if not exists pact_messages_action_card_idx on public.pact_messages(action_card_id) where action_card_id is not null;

drop policy if exists "Active members can send their own messages" on public.pact_messages;
create policy "Active members can send their own messages"
on public.pact_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (select 1 from public.pact_members m where m.pact_id = pact_messages.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active')
  and (action_card_id is null or exists (select 1 from public.pact_action_cards c where c.card_id = pact_messages.action_card_id and c.pact_id = pact_messages.pact_id))
);

revoke insert on public.pact_messages from authenticated;
grant insert (pact_id, body, action_card_id) on public.pact_messages to authenticated;

create or replace function public.share_pact_action_card(p_card_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); card public.pact_action_cards; result uuid;
begin
  select * into card from public.pact_action_cards c join public.pact_members m on m.pact_id = c.pact_id and m.user_id = caller and m.membership_status = 'active' where c.card_id = p_card_id;
  if not found then raise exception 'Active Pact member and action card required' using errcode = '42501'; end if;
  insert into public.pact_messages(pact_id, sender_id, body, action_card_id)
  values (card.pact_id, caller, card.title || E'\n' || card.description, card.card_id)
  returning message_id into result;
  return result;
end;
$$;

revoke all on function public.share_pact_action_card(uuid) from public, anon;
grant execute on function public.share_pact_action_card(uuid) to authenticated;

commit;
