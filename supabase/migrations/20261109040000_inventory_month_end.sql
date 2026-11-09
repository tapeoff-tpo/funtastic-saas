CREATE TABLE IF NOT EXISTS public.inventory_month_end_imports (
  user_id uuid NOT NULL,
  reference_month varchar(7) NOT NULL CHECK (reference_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  source_file_name text NOT NULL,
  source_hash varchar(64) NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  as_of_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reference_month)
);
CREATE TABLE IF NOT EXISTS public.inventory_month_end_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reference_month varchar(7) NOT NULL,
  sku varchar(100) NOT NULL,
  product_name text NOT NULL,
  option_name varchar(200),
  warehouse_zone varchar(100),
  sector_code varchar(100),
  packaging_unit varchar(200),
  total_stock integer NOT NULL,
  reserved_stock integer NOT NULL DEFAULT 0,
  available_stock integer NOT NULL,
  monthly_incoming integer NOT NULL DEFAULT 0,
  monthly_outgoing integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (user_id, reference_month) REFERENCES public.inventory_month_end_imports(user_id, reference_month)
);
CREATE INDEX IF NOT EXISTS inventory_month_end_user_month_sku_idx
  ON public.inventory_month_end_stock(user_id, reference_month, sku);
ALTER TABLE public.inventory_month_end_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_month_end_stock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_month_end_imports, public.inventory_month_end_stock FROM anon, authenticated;
