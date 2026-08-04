DO $$
DECLARE v_prop uuid; v_msg text;
BEGIN
  SELECT id INTO v_prop FROM public.properties WHERE short_code='BRIJ' LIMIT 1;
  BEGIN
    DECLARE n1 text; n2 text;
    BEGIN
      n1 := public.generate_bill_number(v_prop,'banquet');
      n2 := public.generate_bill_number(v_prop,'banquet');
      RAISE EXCEPTION 'NEXTNUM next=% then=%', n1, n2;
    END;
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  INSERT INTO public.activity_log (property_id,user_id,user_name,action_type,module,reference_label,details)
  VALUES (v_prop,NULL,'System','BANQUET_UNIFY_P2_NUMTEST','Banquet','Next number check',
          jsonb_build_object('result', v_msg));
END $$;