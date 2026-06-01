-- Locked order item snapshots are now used for pre-shipment confirmed item
-- overrides as well as shipment-time locks. Keep source rows immutable only
-- after shipment completion.

CREATE OR REPLACE FUNCTION public.prevent_locked_order_item_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  current_order_status text;
BEGIN
  SELECT status::text INTO current_order_status
  FROM public.orders
  WHERE id = OLD.order_id;

  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL
      AND COALESCE(current_order_status, '') NOT IN ('new', 'confirmed', 'preparing', 'ready')
    THEN
      RAISE EXCEPTION '출고완료로 잠긴 주문 상품은 먼저 관리자 잠금 해제가 필요합니다.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.locked_at IS NOT NULL
    AND NEW.locked_at IS NOT NULL
    AND COALESCE(current_order_status, '') NOT IN ('new', 'confirmed', 'preparing', 'ready')
  THEN
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
$function$;
