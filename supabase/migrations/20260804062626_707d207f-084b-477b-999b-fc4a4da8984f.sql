ALTER TABLE public.payment_methods DISABLE TRIGGER tg_payment_methods_protect_default_delete;

DELETE FROM public.wipe_logs WHERE property_id = 'ac0d2840-afe3-4818-92bc-a9295a75a70f';
DELETE FROM public.properties WHERE id = 'ac0d2840-afe3-4818-92bc-a9295a75a70f';

ALTER TABLE public.payment_methods ENABLE TRIGGER tg_payment_methods_protect_default_delete;