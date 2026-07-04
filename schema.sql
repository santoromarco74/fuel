-- ============================================================
-- FuelTracker — Schema Supabase
-- Tabelle: vehicles, refuels
-- Progettato per sync offline-first (outbox pattern):
--   - PK uuid generati client-side
--   - soft delete via deleted_at (le cancellazioni si propagano)
--   - updated_at gestito da trigger (last-write-wins)
-- ============================================================

-- ---------- ENUM ----------
create type fuel_type as enum (
  'benzina', 'diesel', 'gpl', 'metano', 'elettrico', 'ibrido'
);

-- ---------- VEHICLES ----------
create table public.vehicles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  name              text not null,              -- es. "Panda di casa"
  make              text,                       -- es. "Fiat"
  model             text,                       -- es. "Panda 1.2"
  plate             text,                       -- targa (opzionale)
  fuel              fuel_type not null default 'benzina',
  initial_odometer_km numeric(10,1),            -- km alla presa in carico
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz                 -- soft delete per sync
);

-- ---------- REFUELS ----------
create table public.refuels (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  vehicle_id      uuid not null
                  references public.vehicles (id) on delete cascade,
  refueled_at     timestamptz not null default now(),
  odometer_km     numeric(10,1) not null check (odometer_km >= 0),
  liters          numeric(8,2)  not null check (liters > 0),
  price_per_liter numeric(6,3)  not null check (price_per_liter >= 0),
  total_cost      numeric(8,2) generated always as
                  (round(liters * price_per_liter, 2)) stored,
  is_full_tank    boolean not null default true,
  station         text,                         -- distributore (opzionale)
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- ---------- INDICI ----------
create index idx_vehicles_user      on public.vehicles (user_id) where deleted_at is null;
create index idx_refuels_user       on public.refuels  (user_id) where deleted_at is null;
create index idx_refuels_vehicle    on public.refuels  (vehicle_id, refueled_at desc) where deleted_at is null;
-- per il pull incrementale del sync (records modificati dopo l'ultimo sync)
create index idx_vehicles_updated   on public.vehicles (user_id, updated_at);
create index idx_refuels_updated    on public.refuels  (user_id, updated_at);

-- ---------- TRIGGER updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_vehicles_updated
  before update on public.vehicles
  for each row execute function public.set_updated_at();

create trigger trg_refuels_updated
  before update on public.refuels
  for each row execute function public.set_updated_at();

-- ---------- ROW LEVEL SECURITY ----------
alter table public.vehicles enable row level security;
alter table public.refuels  enable row level security;

-- Vehicles
create policy "vehicles_select_own" on public.vehicles
  for select using (user_id = auth.uid());
create policy "vehicles_insert_own" on public.vehicles
  for insert with check (user_id = auth.uid());
create policy "vehicles_update_own" on public.vehicles
  for update using (user_id = auth.uid());
create policy "vehicles_delete_own" on public.vehicles
  for delete using (user_id = auth.uid());

-- Refuels
create policy "refuels_select_own" on public.refuels
  for select using (user_id = auth.uid());
create policy "refuels_insert_own" on public.refuels
  for insert with check (user_id = auth.uid());
create policy "refuels_update_own" on public.refuels
  for update using (user_id = auth.uid());
create policy "refuels_delete_own" on public.refuels
  for delete using (user_id = auth.uid());

-- ============================================================
-- VISTA CONSUMI: km/l e l/100km calcolati tra pieni consecutivi
-- Logica: per ogni pieno (is_full_tank = true) si prende il pieno
-- precedente dello stesso veicolo; i litri consumati nel tratto
-- sono la somma dei litri di TUTTI i rifornimenti (pieni e
-- rabbocchi) successivi al pieno precedente, fino al pieno corrente
-- incluso. I km sono la differenza di odometro tra i due pieni.
-- ============================================================
create or replace view public.v_consumption
with (security_invoker = true)  -- rispetta le RLS del chiamante
as
with full_tanks as (
  select
    r.*,
    lag(odometer_km)  over w as prev_odometer_km,
    lag(refueled_at)  over w as prev_refueled_at
  from public.refuels r
  where r.is_full_tank
    and r.deleted_at is null
  window w as (partition by r.vehicle_id order by r.odometer_km)
),
segments as (
  select
    ft.id,
    ft.user_id,
    ft.vehicle_id,
    ft.refueled_at,
    ft.odometer_km,
    ft.prev_odometer_km,
    ft.odometer_km - ft.prev_odometer_km as distance_km,
    -- litri di tutti i rifornimenti nel tratto (rabbocchi inclusi)
    (
      select sum(x.liters)
      from public.refuels x
      where x.vehicle_id = ft.vehicle_id
        and x.deleted_at is null
        and x.odometer_km >  ft.prev_odometer_km
        and x.odometer_km <= ft.odometer_km
    ) as liters_consumed,
    (
      select sum(x.total_cost)
      from public.refuels x
      where x.vehicle_id = ft.vehicle_id
        and x.deleted_at is null
        and x.odometer_km >  ft.prev_odometer_km
        and x.odometer_km <= ft.odometer_km
    ) as segment_cost
  from full_tanks ft
  where ft.prev_odometer_km is not null
)
select
  id,
  user_id,
  vehicle_id,
  refueled_at,
  odometer_km,
  distance_km,
  liters_consumed,
  round(distance_km / nullif(liters_consumed, 0), 2)        as km_per_liter,
  round(liters_consumed * 100 / nullif(distance_km, 0), 2)  as liters_per_100km,
  round(segment_cost / nullif(distance_km, 0), 3)           as cost_per_km
from segments
where distance_km > 0;
