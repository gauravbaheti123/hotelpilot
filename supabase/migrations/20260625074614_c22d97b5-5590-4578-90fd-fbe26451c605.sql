
CREATE POLICY "front desk read room_categories" ON public.room_categories
  FOR SELECT TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()));

CREATE POLICY "front desk read rooms" ON public.rooms
  FOR SELECT TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()));

CREATE POLICY "front desk read tariff_plans" ON public.tariff_plans
  FOR SELECT TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()));
