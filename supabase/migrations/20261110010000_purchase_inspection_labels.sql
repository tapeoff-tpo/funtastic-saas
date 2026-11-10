CREATE TABLE IF NOT EXISTS public.purchase_inspection_label_files (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  sku text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('quality', 'barcode')),
  file_name text NOT NULL,
  content_type text NOT NULL,
  file_size integer NOT NULL,
  object_key text NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_inspection_label_files_sku_idx
  ON public.purchase_inspection_label_files (user_id, sku, kind, created_at DESC, id DESC);
ALTER TABLE public.purchase_inspection_label_files ENABLE ROW LEVEL SECURITY;
