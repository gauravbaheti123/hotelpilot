DO $$
DECLARE d text;
BEGIN
  FOREACH d IN ARRAY ARRAY[
    pg_get_functiondef('public.update_booking_safe_fields(jsonb)'::regprocedure),
    pg_get_functiondef('public.create_booking(jsonb)'::regprocedure)
  ]
  LOOP
    d := replace(
      d,
      'INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, description)',
      'INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, reference_label)'
    );
    EXECUTE d;
  END LOOP;
END $$;