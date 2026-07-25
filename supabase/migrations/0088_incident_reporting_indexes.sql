create index if not exists incidents_location_occurred_at_idx
  on public.incidents (location_id, occurred_at desc);

create index if not exists incidents_type_occurred_at_idx
  on public.incidents (type, occurred_at desc);
