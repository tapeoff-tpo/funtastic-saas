ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS normalized_tracking_number varchar(100);

UPDATE public.shipments
SET normalized_tracking_number = upper(regexp_replace(tracking_number, '[^0-9A-Za-z]', '', 'g'))
WHERE normalized_tracking_number IS DISTINCT FROM upper(regexp_replace(tracking_number, '[^0-9A-Za-z]', '', 'g'));

CREATE OR REPLACE FUNCTION public.set_shipments_normalized_tracking_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.normalized_tracking_number := upper(regexp_replace(COALESCE(NEW.tracking_number, ''), '[^0-9A-Za-z]', '', 'g'));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_shipments_normalized_tracking_number ON public.shipments;
CREATE TRIGGER set_shipments_normalized_tracking_number
BEFORE INSERT OR UPDATE OF tracking_number ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION public.set_shipments_normalized_tracking_number();

ALTER TABLE public.shipments
  ALTER COLUMN normalized_tracking_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS shipments_user_normalized_tracking_number_idx
  ON public.shipments (user_id, normalized_tracking_number);
