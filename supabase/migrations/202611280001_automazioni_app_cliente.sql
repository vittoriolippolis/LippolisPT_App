-- Automazioni (messaggi automatici in chat) e impostazioni dell'app cliente.
-- Le impostazioni sono del PT (una riga per coach); il cliente legge solo la parte «app» con athlete_app_settings().
-- Il motore gira dentro il database ogni 15 minuti (pg_cron) e scrive nella chat come il PT.

alter table public.profiles add column if not exists birth_date date
  check (birth_date is null or birth_date >= date '1900-01-01');

create table public.coach_settings (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  app jsonb not null default '{}'::jsonb check (jsonb_typeof(app) = 'object' and octet_length(app::text) <= 20000),
  automazioni jsonb not null default '{}'::jsonb check (jsonb_typeof(automazioni) = 'object' and octet_length(automazioni::text) <= 40000),
  ultimo_controllo timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.coach_settings enable row level security;
create policy coach_settings_read on public.coach_settings for select to authenticated
  using (coach_id = (select auth.uid()) and private.is_active_coach((select auth.uid())));
revoke all on public.coach_settings from public, anon, authenticated;
grant select on public.coach_settings to authenticated;

-- Registro dei messaggi automatici: ogni evento parte una volta sola (chiave = scheda, anno, soglia…).
create table public.automation_log (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('benvenuto','fine_scheda','compleanno','avanzamento')),
  event_key text not null check (char_length(event_key) between 1 and 120),
  message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (athlete_id, kind, event_key)
);
create index automation_log_coach_idx on public.automation_log (coach_id, created_at desc);
alter table public.automation_log enable row level security;
create policy automation_log_read on public.automation_log for select to authenticated
  using (coach_id = (select auth.uid()) and private.is_active_coach((select auth.uid())));
revoke all on public.automation_log from public, anon, authenticated;
grant select on public.automation_log to authenticated;

create function public.save_coach_settings(p_app jsonb, p_automazioni jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_at timestamptz := now();
begin
  if not private.is_active_coach(v_actor) then raise exception using errcode = '42501', message = 'Accesso PT richiesto'; end if;
  if jsonb_typeof(coalesce(p_app, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_automazioni, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Impostazioni non valide';
  end if;
  insert into public.coach_settings(coach_id, app, automazioni, updated_at)
    values (v_actor, coalesce(p_app, '{}'::jsonb), coalesce(p_automazioni, '{}'::jsonb), v_at)
    on conflict (coach_id) do update set app = excluded.app, automazioni = excluded.automazioni, updated_at = v_at;
  return v_at;
end;
$$;

-- Il cliente legge le impostazioni dell'app del suo PT (solo la parte «app»).
create function public.athlete_app_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select s.app from public.coach_settings s
    join public.profiles p on p.trainer_id = s.coach_id
    where p.id = (select auth.uid()) and p.role = 'athlete'), '{}'::jsonb);
$$;

create function public.coach_set_birth_date(p_athlete uuid, p_date date)
returns date language plpgsql security definer set search_path = '' as $$
begin
  if not private.coach_owns_athlete(auth.uid(), p_athlete) then raise exception using errcode = '42501', message = 'Cliente non autorizzato'; end if;
  update public.profiles set birth_date = p_date, updated_at = now() where id = p_athlete;
  return p_date;
end;
$$;

-- Testo del messaggio con i segnaposto {nome}, {scheda}, {mancano}, {fatti}, {totali}.
create function private.automation_text(p_template text, p_first_name text, p_program text, p_left integer, p_done integer, p_total integer)
returns text language sql immutable set search_path = '' as $$
  select left(btrim(replace(replace(replace(replace(replace(coalesce(p_template, ''),
    '{nome}', coalesce(p_first_name, '')), '{scheda}', coalesce(p_program, 'la tua scheda')),
    '{mancano}', coalesce(p_left::text, '')), '{fatti}', coalesce(p_done::text, '')), '{totali}', coalesce(p_total::text, ''))), 4000);
$$;

create function private.automation_send(p_coach uuid, p_athlete uuid, p_kind text, p_key text, p_text text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_log uuid; v_message uuid;
begin
  if coalesce(btrim(p_text), '') = '' then return false; end if;
  insert into public.automation_log(coach_id, athlete_id, kind, event_key)
    values (p_coach, p_athlete, p_kind, p_key)
    on conflict (athlete_id, kind, event_key) do nothing
    returning id into v_log;
  if v_log is null then return false; end if;
  insert into public.messages(athlete_id, sender_id, target_id, channel, type, text, metadata)
    values (p_athlete, p_coach, p_athlete, 'thread', 'automazione', p_text, jsonb_build_object('automazione', p_kind, 'plainText', true))
    returning id into v_message;
  update public.automation_log set message_id = v_message where id = v_log;
  return true;
end;
$$;

-- Motore: per ogni PT con automazioni attive, dentro la fascia oraria (ora italiana).
create function private.run_automations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record; a record;
  v_local timestamp := now() at time zone 'Europe/Rome';
  v_hour integer := extract(hour from (now() at time zone 'Europe/Rome'))::integer;
  v_from integer; v_to integer; v_sent integer := 0;
  v_total integer; v_done integer; v_left integer; v_pct integer; v_n integer; v_program text; v_version text;
  v_threshold integer; v_cfg jsonb;
begin
  for s in select * from public.coach_settings where automazioni <> '{}'::jsonb loop
    if not private.is_active_coach(s.coach_id) then continue; end if;
    v_cfg := s.automazioni;
    v_from := coalesce(nullif(v_cfg #>> '{fascia,da}', '')::integer, 8);
    v_to := coalesce(nullif(v_cfg #>> '{fascia,a}', '')::integer, 21);
    update public.coach_settings set ultimo_controllo = now() where coach_id = s.coach_id;
    if v_hour < v_from or v_hour >= v_to then continue; end if;

    for a in
      select p.id, p.first_name, p.birth_date, coalesce(p.onboarding_completed_at, p.created_at) as since,
             pr.program, pr.version_id::text as version_id, st.snapshot
      from public.profiles p
      left join public.programs pr on pr.athlete_id = p.id
      left join public.athlete_states st on st.user_id = p.id
      where p.trainer_id = s.coach_id and p.role = 'athlete' and p.status = 'active' and p.onboarding_complete
    loop
      -- Benvenuto: solo ai clienti arrivati negli ultimi 3 giorni (chi c'era già non lo riceve).
      if (v_cfg #>> '{benvenuto,attiva}') = 'true' and a.since > now() - interval '3 days' then
        if private.automation_send(s.coach_id, a.id, 'benvenuto', 'una_volta',
          private.automation_text(v_cfg #>> '{benvenuto,testo}', a.first_name, a.program ->> 'nome', null, null, null)) then v_sent := v_sent + 1; end if;
      end if;

      -- Compleanno (il 29 febbraio, negli anni non bisestili, vale il 28).
      if (v_cfg #>> '{compleanno,attiva}') = 'true' and a.birth_date is not null
         and extract(month from a.birth_date) = extract(month from v_local)
         and (extract(day from a.birth_date) = extract(day from v_local)
              or (extract(month from a.birth_date) = 2 and extract(day from a.birth_date) = 29 and extract(day from v_local) = 28
                  and extract(day from (date_trunc('month', v_local) + interval '1 month - 1 day')) = 28)) then
        if private.automation_send(s.coach_id, a.id, 'compleanno', extract(year from v_local)::text,
          private.automation_text(v_cfg #>> '{compleanno,testo}', a.first_name, a.program ->> 'nome', null, null, null)) then v_sent := v_sent + 1; end if;
      end if;

      if a.program is null or jsonb_typeof(a.program -> 'settimane') <> 'array' then continue; end if;
      select coalesce(sum(case when jsonb_typeof(w -> 'giorni') = 'array' then jsonb_array_length(w -> 'giorni') else 0 end), 0)::integer
        into v_total from jsonb_array_elements(a.program -> 'settimane') w;
      if v_total < 1 then continue; end if;
      select count(distinct (x ->> 'settimana') || '-' || (x ->> 'giorno'))::integer into v_done
        from jsonb_array_elements(case when jsonb_typeof(a.snapshot -> 'sessioni') = 'array' then a.snapshot -> 'sessioni' else '[]'::jsonb end) x
        where x ->> 'programVersionId' = a.version_id;
      v_done := least(v_done, v_total);
      v_left := v_total - v_done;
      v_pct := floor(v_done * 100.0 / v_total)::integer;
      v_program := a.program ->> 'nome';
      v_version := a.version_id;

      -- Fine scheda: quando mancano N allenamenti (una volta per scheda).
      v_n := least(greatest(coalesce(nullif(v_cfg #>> '{fineScheda,allenamenti}', '')::integer, 3), 1), 20);
      if (v_cfg #>> '{fineScheda,attiva}') = 'true' and v_done > 0 and v_left > 0 and v_left <= v_n then
        if private.automation_send(s.coach_id, a.id, 'fine_scheda', v_version,
          private.automation_text(v_cfg #>> '{fineScheda,testo}', a.first_name, v_program, v_left, v_done, v_total)) then v_sent := v_sent + 1; end if;
      end if;

      -- Avanzamento: metà scheda e scheda completata (una volta per soglia e per scheda).
      if (v_cfg #>> '{avanzamento,attiva}') = 'true' then
        foreach v_threshold in array array[50, 100] loop
          if v_pct >= v_threshold and (v_threshold = 100 or v_pct < 100) then
            if private.automation_send(s.coach_id, a.id, 'avanzamento', v_version || ':' || v_threshold,
              private.automation_text(v_cfg #>> array['avanzamento', 'testo' || v_threshold], a.first_name, v_program, v_left, v_done, v_total)) then v_sent := v_sent + 1; end if;
          end if;
        end loop;
      end if;
    end loop;
  end loop;
  return v_sent;
end;
$$;
revoke all on function private.run_automations() from public, anon, authenticated;
revoke all on function private.automation_send(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Pianificazione ogni 15 minuti. Se pg_cron non è disponibile la migration non si blocca:
-- il pannello mostra «Ultimo controllo» e si vede subito che il motore non gira.
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  if exists (select 1 from cron.job where jobname = 'lpt-automazioni') then
    perform cron.unschedule('lpt-automazioni');
  end if;
  perform cron.schedule('lpt-automazioni', '*/15 * * * *', 'select private.run_automations()');
exception when others then
  raise warning 'pg_cron non disponibile: automazioni non pianificate (%)', sqlerrm;
end;
$$;
