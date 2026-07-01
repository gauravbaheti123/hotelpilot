
ALTER TABLE public.menu_categories
  ADD COLUMN IF NOT EXISTS kot_printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS kitchen_printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_menu_categories_kot_printer ON public.menu_categories(kot_printer_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_kitchen_printer ON public.menu_items(kitchen_printer_id);
