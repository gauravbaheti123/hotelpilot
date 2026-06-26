
CREATE INDEX IF NOT EXISTS idx_bookings_property_status ON public.bookings(property_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_property_checkin ON public.bookings(property_id, check_in);
CREATE INDEX IF NOT EXISTS idx_bookings_property_checkout ON public.bookings(property_id, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_property_created ON public.bookings(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_guest ON public.bookings(guest_id);

CREATE INDEX IF NOT EXISTS idx_rooms_property_status ON public.rooms(property_id, status);

CREATE INDEX IF NOT EXISTS idx_kot_orders_property_created ON public.kot_orders(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kot_orders_property_status ON public.kot_orders(property_id, status);
CREATE INDEX IF NOT EXISTS idx_kot_orders_booking ON public.kot_orders(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kot_items_kot ON public.kot_items(kot_id);

CREATE INDEX IF NOT EXISTS idx_folios_property_created ON public.folios(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_folios_booking ON public.folios(booking_id);
CREATE INDEX IF NOT EXISTS idx_folio_charges_folio ON public.folio_charges(folio_id);

CREATE INDEX IF NOT EXISTS idx_booking_rooms_booking ON public.booking_rooms(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_rooms_room ON public.booking_rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_booking_guests_booking ON public.booking_guests(booking_id);

CREATE INDEX IF NOT EXISTS idx_guests_property_created ON public.guests(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guests_property_mobile ON public.guests(property_id, mobile);

CREATE INDEX IF NOT EXISTS idx_payments_property_created ON public.payments(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_folio ON public.payments(folio_id);

CREATE INDEX IF NOT EXISTS idx_expenses_property_date ON public.expenses(property_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_housekeeping_property_status ON public.housekeeping_tasks(property_id, status);

CREATE INDEX IF NOT EXISTS idx_event_room_blocks_property ON public.event_room_blocks(property_id);
CREATE INDEX IF NOT EXISTS idx_event_room_blocks_event ON public.event_room_blocks(banquet_booking_id);

CREATE INDEX IF NOT EXISTS idx_banquet_property_date ON public.banquet_bookings(property_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_property_created ON public.activity_log(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communications_property_created ON public.communications(property_id, created_at DESC);
