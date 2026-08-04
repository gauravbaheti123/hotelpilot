DROP TRIGGER IF EXISTS trg_event_block_sync_br_upd ON public.event_room_blocks;
CREATE TRIGGER trg_event_block_sync_br_upd
AFTER UPDATE OF status, room_id, checkin_date, checkout_date, checkin_time, checkout_time, special_rate, booking_id
ON public.event_room_blocks
FOR EACH ROW EXECUTE FUNCTION public.tg_event_block_sync_booking_room();