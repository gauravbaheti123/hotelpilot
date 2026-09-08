UPDATE public.guests
SET id_proof_number = replace(id_proof_number, ' ', '')
WHERE id_proof_number ~ '^[0-9]{4} [0-9]{4} [0-9]{4}$';

GRANT EXECUTE ON FUNCTION public.user_discount_limit(uuid, uuid) TO authenticated;