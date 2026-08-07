CREATE TABLE IF NOT EXISTS public.ecount_purchase_history_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  source_file_name varchar(255) NOT NULL,
  source_sheet_name varchar(100) NOT NULL DEFAULT '발주요청조회',
  period_start date,
  period_end date,
  total_rows integer NOT NULL DEFAULT 0,
  completed_rows integer NOT NULL DEFAULT 0,
  in_progress_rows integer NOT NULL DEFAULT 0,
  uploaded_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ecount_purchase_history_batches_user_file
  ON public.ecount_purchase_history_batches (user_id, source_file_name);
CREATE INDEX IF NOT EXISTS ecount_purchase_history_batches_user_created
  ON public.ecount_purchase_history_batches (user_id, created_at);

CREATE TABLE IF NOT EXISTS public.ecount_purchase_history_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  batch_id uuid REFERENCES public.ecount_purchase_history_batches(id) ON DELETE SET NULL,
  source_request_number varchar(100) NOT NULL,
  request_date date,
  manager_name varchar(100),
  warehouse_name varchar(100),
  source_product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  source_note text,
  source_status varchar(30) NOT NULL,
  match_status varchar(30) NOT NULL DEFAULT 'unmatched',
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  sku varchar(100),
  candidate_skus jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ecount_purchase_history_items_user_request
  ON public.ecount_purchase_history_items (user_id, source_request_number);
CREATE INDEX IF NOT EXISTS ecount_purchase_history_items_user_date
  ON public.ecount_purchase_history_items (user_id, request_date);
CREATE INDEX IF NOT EXISTS ecount_purchase_history_items_user_match
  ON public.ecount_purchase_history_items (user_id, match_status);
CREATE INDEX IF NOT EXISTS ecount_purchase_history_items_product
  ON public.ecount_purchase_history_items (product_id);
