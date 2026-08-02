CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  state text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cities_global_name_uniq ON public.cities (lower(name)) WHERE property_id IS NULL;
CREATE UNIQUE INDEX cities_property_name_uniq ON public.cities (property_id, lower(name)) WHERE property_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cities TO authenticated;
GRANT ALL ON public.cities TO service_role;

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cities_select" ON public.cities FOR SELECT TO authenticated
  USING (property_id IS NULL OR public.user_has_property(auth.uid(), property_id));

CREATE POLICY "cities_insert" ON public.cities FOR INSERT TO authenticated
  WITH CHECK (property_id IS NOT NULL AND public.user_has_property(auth.uid(), property_id));

CREATE POLICY "cities_update" ON public.cities FOR UPDATE TO authenticated
  USING (property_id IS NOT NULL AND public.can_manage_masters(auth.uid(), property_id))
  WITH CHECK (property_id IS NOT NULL AND public.can_manage_masters(auth.uid(), property_id));

CREATE POLICY "cities_delete" ON public.cities FOR DELETE TO authenticated
  USING (property_id IS NOT NULL AND public.can_manage_masters(auth.uid(), property_id));

CREATE TRIGGER cities_set_updated_at BEFORE UPDATE ON public.cities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.cities (property_id, name, state) VALUES
 (NULL,'Agra','Uttar Pradesh'),(NULL,'Ahmedabad','Gujarat'),(NULL,'Ajmer','Rajasthan'),
 (NULL,'Amritsar','Punjab'),(NULL,'Aurangabad','Maharashtra'),(NULL,'Bengaluru','Karnataka'),
 (NULL,'Bhopal','Madhya Pradesh'),(NULL,'Bhubaneswar','Odisha'),(NULL,'Chandigarh','Chandigarh'),
 (NULL,'Chennai','Tamil Nadu'),(NULL,'Coimbatore','Tamil Nadu'),(NULL,'Dehradun','Uttarakhand'),
 (NULL,'Delhi','Delhi'),(NULL,'Faridabad','Haryana'),(NULL,'Ghaziabad','Uttar Pradesh'),
 (NULL,'Panaji','Goa'),(NULL,'Gurugram','Haryana'),(NULL,'Guwahati','Assam'),
 (NULL,'Gwalior','Madhya Pradesh'),(NULL,'Hyderabad','Telangana'),(NULL,'Indore','Madhya Pradesh'),
 (NULL,'Jaipur','Rajasthan'),(NULL,'Jalandhar','Punjab'),(NULL,'Jammu','Jammu and Kashmir'),
 (NULL,'Jamshedpur','Jharkhand'),(NULL,'Jodhpur','Rajasthan'),(NULL,'Kanpur','Uttar Pradesh'),
 (NULL,'Kochi','Kerala'),(NULL,'Kolhapur','Maharashtra'),(NULL,'Kolkata','West Bengal'),
 (NULL,'Kota','Rajasthan'),(NULL,'Lucknow','Uttar Pradesh'),(NULL,'Ludhiana','Punjab'),
 (NULL,'Madurai','Tamil Nadu'),(NULL,'Mangaluru','Karnataka'),(NULL,'Mumbai','Maharashtra'),
 (NULL,'Mysuru','Karnataka'),(NULL,'Nagpur','Maharashtra'),(NULL,'Nashik','Maharashtra'),
 (NULL,'Navi Mumbai','Maharashtra'),(NULL,'Noida','Uttar Pradesh'),(NULL,'Patna','Bihar'),
 (NULL,'Pune','Maharashtra'),(NULL,'Raipur','Chhattisgarh'),(NULL,'Rajkot','Gujarat'),
 (NULL,'Ranchi','Jharkhand'),(NULL,'Shimla','Himachal Pradesh'),(NULL,'Siliguri','West Bengal'),
 (NULL,'Solapur','Maharashtra'),(NULL,'Srinagar','Jammu and Kashmir'),(NULL,'Surat','Gujarat'),
 (NULL,'Thane','Maharashtra'),(NULL,'Thiruvananthapuram','Kerala'),(NULL,'Tiruchirappalli','Tamil Nadu'),
 (NULL,'Udaipur','Rajasthan'),(NULL,'Vadodara','Gujarat'),(NULL,'Varanasi','Uttar Pradesh'),
 (NULL,'Vijayawada','Andhra Pradesh'),(NULL,'Visakhapatnam','Andhra Pradesh');