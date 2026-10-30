ALTER TYPE public.purchase_request_status ADD VALUE IF NOT EXISTS 'inspecting' BEFORE 'china_arrived';
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS purchase_inspection jsonb;
