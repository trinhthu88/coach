-- Align legacy Training module configuration with the canonical child contract.
--
-- Some hosted programme configurations predate explicit training_week_ids. If
-- the configured parent requirement exactly matches the visible Skill Card
-- children for that programme, make those children explicit. Ambiguous
-- configurations are deliberately left untouched for Admin validation.

DO $migration$
DECLARE
  module_row record;
  selected_ids jsonb;
  configured_units integer;
BEGIN
  FOR module_row IN
    SELECT pm.id, pm.programme_id, pm.config
    FROM public.programme_modules pm
    WHERE pm.module = 'training'::public.programme_module_type
      AND pm.enabled
      AND coalesce((pm.config->>'required')::boolean, false)
      AND (
        jsonb_typeof(pm.config->'distribution_settings'->'training_week_ids')
          IS DISTINCT FROM 'array'
        OR jsonb_array_length(
          coalesce(pm.config->'distribution_settings'->'training_week_ids', '[]'::jsonb)
        ) = 0
      )
  LOOP
    SELECT coalesce(
      jsonb_agg(to_jsonb(tw.id::text) ORDER BY tw.week_number, tw.sort_order, tw.id),
      '[]'::jsonb
    )
    INTO selected_ids
    FROM public.training_weeks tw
    WHERE tw.programme_id = module_row.programme_id
      AND tw.is_visible
      AND tw.skill_card_visible;

    configured_units := coalesce(
      public.programme_config_integer(module_row.config, 'required_units'),
      0
    );

    IF jsonb_array_length(selected_ids) = configured_units
       AND configured_units > 0 THEN
      UPDATE public.programme_modules
      SET config = jsonb_set(
        jsonb_set(
          module_row.config,
          '{distribution_settings}',
          coalesce(module_row.config->'distribution_settings', '{}'::jsonb),
          true
        ),
        '{distribution_settings,training_week_ids}',
        selected_ids,
        true
      )
      WHERE id = module_row.id;
    END IF;
  END LOOP;
END
$migration$;