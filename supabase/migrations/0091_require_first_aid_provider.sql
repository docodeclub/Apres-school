create or replace function public.require_first_aid_provider()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type = 'first_aid'
    and length(trim(coalesce(new.details ->> 'firstAidProvider', ''))) < 2
  then
    raise exception 'Add who performed first aid.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists require_first_aid_provider_before_insert on public.incidents;

create trigger require_first_aid_provider_before_insert
before insert on public.incidents
for each row
execute function public.require_first_aid_provider();
