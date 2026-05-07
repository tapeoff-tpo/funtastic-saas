ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS locked_sku varchar(100),
  ADD COLUMN IF NOT EXISTS locked_product_name text,
  ADD COLUMN IF NOT EXISTS locked_option_name text,
  ADD COLUMN IF NOT EXISTS locked_quantity integer,
  ADD COLUMN IF NOT EXISTS locked_mapping_code_id uuid,
  ADD COLUMN IF NOT EXISTS locked_mapping_code varchar(100),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by_user_id uuid;

CREATE INDEX IF NOT EXISTS order_items_locked_at_idx
  ON public.order_items (locked_at)
  WHERE locked_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_locked_order_item_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION '출고완료로 잠긴 주문 상품은 먼저 관리자 잠금 해제가 필요합니다.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NOT NULL THEN
    IF NEW.marketplace_item_id IS DISTINCT FROM OLD.marketplace_item_id
      OR NEW.product_name IS DISTINCT FROM OLD.product_name
      OR NEW.option_text IS DISTINCT FROM OLD.option_text
      OR NEW.quantity IS DISTINCT FROM OLD.quantity
      OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
      OR NEW.sku IS DISTINCT FROM OLD.sku
      OR NEW.sku_multiplier IS DISTINCT FROM OLD.sku_multiplier
      OR NEW.fulfillment_code IS DISTINCT FROM OLD.fulfillment_code
      OR NEW.locked_sku IS DISTINCT FROM OLD.locked_sku
      OR NEW.locked_product_name IS DISTINCT FROM OLD.locked_product_name
      OR NEW.locked_option_name IS DISTINCT FROM OLD.locked_option_name
      OR NEW.locked_quantity IS DISTINCT FROM OLD.locked_quantity
      OR NEW.locked_mapping_code_id IS DISTINCT FROM OLD.locked_mapping_code_id
      OR NEW.locked_mapping_code IS DISTINCT FROM OLD.locked_mapping_code
    THEN
      RAISE EXCEPTION '출고완료로 잠긴 주문 상품은 먼저 관리자 잠금 해제가 필요합니다.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_locked_order_item_changes ON public.order_items;
CREATE TRIGGER prevent_locked_order_item_changes
BEFORE UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.prevent_locked_order_item_changes();
