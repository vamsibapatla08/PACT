-- Demo data for local development only (runs on `supabase db reset`).
-- Never run this on the live project.

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rory@example.com',   '{"full_name": "Rory"}',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nihar@example.com',  '{"full_name": "Nihar"}',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vamsi@example.com',  '{"full_name": "Vamsi"}',  now(), now(), now()),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dimple@example.com', '{"full_name": "Dimple"}', now(), now(), now());

insert into public.pacts (id, name, created_by, invite_code)
values ('10000000-0000-0000-0000-000000000001', 'Austin trip', '00000000-0000-0000-0000-000000000001', 'austin26');

insert into public.pact_members (pact_id, user_id)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');
