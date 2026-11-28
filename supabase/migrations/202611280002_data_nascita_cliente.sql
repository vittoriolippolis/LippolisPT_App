-- Data di nascita inserita dal cliente: in registrazione (link d'invito) e dal Profilo dell'app.
-- Serve all'automazione «Compleanno»; il PT non deve più inserirla a mano.

create or replace function private.valid_birth_date(p_value text)
returns date language plpgsql immutable set search_path = '' as $$
declare v_date date;
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  v_date := p_value::date;
  if v_date < date '1900-01-01' then return null; end if;
  return v_date;
exception when others then return null;
end;
$$;

create or replace function private.register_invited_athlete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := new.raw_app_meta_data ->> 'lippolis_invite';
  v_coach uuid;
  v_first text := new.raw_user_meta_data ->> 'first_name';
  v_last text := new.raw_user_meta_data ->> 'last_name';
  v_birth date := private.valid_birth_date(new.raw_user_meta_data ->> 'birth_date');
begin
  if v_hash is null then return new; end if;
  if v_birth is not null and v_birth > current_date then v_birth := null; end if;
  update private.client_invites set used_at = now()
    where token_hash = v_hash and used_at is null and expires_at > now()
      and private.is_active_coach(coach_id)
    returning coach_id into v_coach;
  if not found then raise exception 'INVITE_UNAVAILABLE'; end if;
  insert into public.profiles(id,first_name,last_name,display_name,email,role,trainer_id,onboarding_complete,onboarding_completed_at,birth_date)
    values(new.id,v_first,v_last,v_first || ' ' || v_last,new.email,'athlete',v_coach,true,now(),v_birth);
  return new;
end;
$$;
revoke all on function private.register_invited_athlete() from public, anon, authenticated;

-- Il cliente imposta (o corregge) la propria data di nascita.
create function public.athlete_set_birth_date(p_date date)
returns date language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if not private.is_active_athlete(v_actor) then raise exception using errcode = '42501', message = 'Accesso cliente richiesto'; end if;
  if p_date is null or p_date < date '1900-01-01' or p_date > current_date then
    raise exception using errcode = '22023', message = 'Data di nascita non valida';
  end if;
  update public.profiles set birth_date = p_date, updated_at = now() where id = v_actor;
  return p_date;
end;
$$;
revoke all on function public.athlete_set_birth_date(date) from public, anon;
grant execute on function public.athlete_set_birth_date(date) to authenticated;
