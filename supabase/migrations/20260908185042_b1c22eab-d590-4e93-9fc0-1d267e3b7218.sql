create or replace function public.get_or_create_open_segment_bill(
  _property_id uuid,
  _segment text,
  _booking_id uuid default null,
  _room_id uuid default null,
  _table_id uuid default null,
  _guest_name text default null,
  _event_booking_id uuid default null,
  _is_walkin boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz;
  v_lock_key text;
  v_folio_id uuid;
  v_bill record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if _property_id is null or _segment is null then
    raise exception 'property and segment are required';
  end if;

  -- Serialize concurrent get-or-create for the same scope (double tap,
  -- two staff punching the same table) so only one open bill can exist.
  v_lock_key := coalesce(_booking_id::text, _table_id::text, coalesce(_guest_name,''))
                || '|' || _segment || '|' || _property_id::text;
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');

  select b.id, b.bill_number, b.folio_id into v_bill
  from public.segment_bills b
  where b.property_id = _property_id
    and b.segment = _segment
    and b.status = 'open'
    and b.is_walkin = coalesce(_is_walkin, false)
    and b.created_at >= v_day_start
    and (
      case
        when _booking_id is not null then b.booking_id = _booking_id
        when _table_id is not null then b.booking_id is null and b.table_id = _table_id
        else b.booking_id is null and b.table_id is null and coalesce(b.guest_name,'') = coalesce(_guest_name,'')
      end
    )
  order by b.created_at desc
  limit 1;

  if found then
    return jsonb_build_object('id', v_bill.id, 'bill_number', v_bill.bill_number, 'folio_id', v_bill.folio_id);
  end if;

  if _booking_id is not null then
    v_folio_id := public.get_or_create_folio(_booking_id);
  end if;

  insert into public.segment_bills (
    property_id, segment, booking_id, folio_id, room_id, table_id,
    is_walkin, event_booking_id, guest_name,
    total_amount, gst_amount, paid_amount, status, created_by
  ) values (
    _property_id, _segment,
    case when coalesce(_is_walkin,false) then null else _booking_id end,
    v_folio_id,
    case when coalesce(_is_walkin,false) then null else _room_id end,
    case when coalesce(_is_walkin,false) then _table_id else null end,
    coalesce(_is_walkin,false),
    case when coalesce(_is_walkin,false) and _segment = 'food' then _event_booking_id else null end,
    _guest_name,
    0, 0, 0, 'open', auth.uid()
  )
  returning id, bill_number, folio_id into v_bill;

  return jsonb_build_object('id', v_bill.id, 'bill_number', v_bill.bill_number, 'folio_id', v_bill.folio_id);
end;
$$;

revoke all on function public.get_or_create_open_segment_bill(uuid, text, uuid, uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.get_or_create_open_segment_bill(uuid, text, uuid, uuid, uuid, text, uuid, boolean) to authenticated;