CREATE INDEX IF NOT EXISTS idx_menu_items_property ON public.menu_items (property_id);
CREATE INDEX IF NOT EXISTS idx_guests_property_name ON public.guests (property_id, name);