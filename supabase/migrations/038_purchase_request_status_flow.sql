ALTER TYPE public.purchase_request_status RENAME VALUE 'china_arrived' TO 'outbound_requested';
ALTER TYPE public.purchase_request_status RENAME VALUE 'purchasing' TO 'china_arrived';
ALTER TYPE public.purchase_request_status RENAME VALUE 'planned' TO 'purchased';
ALTER TYPE public.purchase_request_status RENAME VALUE 'cancelled' TO 'completed';
