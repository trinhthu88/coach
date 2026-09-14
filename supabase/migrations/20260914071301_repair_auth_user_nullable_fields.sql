-- Supabase Auth scans several token and metadata fields as non-null strings/maps.
-- Older demo and fixture users were inserted directly and left these fields NULL,
-- which caused Auth Admin and password-token requests to return HTTP 500.
update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb),
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
where confirmation_token is null
   or recovery_token is null
   or email_change_token_new is null
   or email_change is null
   or phone_change is null
   or phone_change_token is null
   or email_change_token_current is null
   or reauthentication_token is null
   or raw_app_meta_data is null
   or raw_user_meta_data is null;