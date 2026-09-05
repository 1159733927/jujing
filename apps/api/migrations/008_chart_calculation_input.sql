alter table chart_versions
  add column if not exists calculation_input jsonb;

-- Existing immutable versions are birth-data versions. Preserve their exact
-- input as the canonical calculation snapshot before allowing manual charts.
update chart_versions
set calculation_input = birth
where calculation_input is null;

alter table chart_versions
  alter column calculation_input set not null;

-- Manual four-pillar input deliberately has no civil birth date or location.
alter table chart_versions
  alter column birth drop not null;

alter table chart_versions
  drop constraint if exists chart_versions_birth_input_mode_check;

alter table chart_versions
  add constraint chart_versions_birth_input_mode_check check (
    (calculation_input ->> 'inputMode' = 'manual-four-pillars' and birth is null)
    or
    (coalesce(calculation_input ->> 'inputMode', 'birth-data') = 'birth-data' and birth is not null)
  );
