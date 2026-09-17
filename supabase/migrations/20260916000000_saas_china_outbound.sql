-- Isolated SaaS China inventory and outbound workflow.
-- Intentionally no foreign keys to china_warehouse_inventory or purchase_request_items:
-- raw Ecount imports can continue safely while this SaaS workflow is developed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.saas_china_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_code varchar(100) NOT NULL DEFAULT 'default',
  sku varchar(100) NOT NULL,
  product_name text NOT NULL,
  option_key varchar(200) NOT NULL DEFAULT '',
  option_name varchar(200),
  on_hand_quantity integer NOT NULL DEFAULT 0,
  reserved_quantity integer NOT NULL DEFAULT 0,
  available_quantity integer NOT NULL DEFAULT 0,
  last_received_at timestamptz,
  last_outbound_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_china_inventory_id_user_key UNIQUE (id, user_id),
  CONSTRAINT saas_china_inventory_on_hand_nonnegative CHECK (on_hand_quantity >= 0),
  CONSTRAINT saas_china_inventory_reserved_nonnegative CHECK (reserved_quantity >= 0),
  CONSTRAINT saas_china_inventory_available_nonnegative CHECK (available_quantity >= 0),
  CONSTRAINT saas_china_inventory_available_matches_balance
    CHECK (available_quantity = on_hand_quantity - reserved_quantity)
);

CREATE UNIQUE INDEX IF NOT EXISTS saas_china_inventory_user_warehouse_sku_option
  ON public.saas_china_inventory(user_id, warehouse_code, sku, option_key);
CREATE INDEX IF NOT EXISTS saas_china_inventory_user_sku
  ON public.saas_china_inventory(user_id, sku);
CREATE INDEX IF NOT EXISTS saas_china_inventory_user_warehouse_available
  ON public.saas_china_inventory(user_id, warehouse_code, sku)
  WHERE available_quantity > 0;

CREATE TABLE IF NOT EXISTS public.saas_china_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL,
  user_id uuid NOT NULL,
  movement_type varchar(40) NOT NULL,
  on_hand_delta integer NOT NULL DEFAULT 0,
  reserved_delta integer NOT NULL DEFAULT 0,
  on_hand_before integer NOT NULL,
  reserved_before integer NOT NULL,
  on_hand_after integer NOT NULL,
  reserved_after integer NOT NULL,
  source_key varchar(255),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_china_inventory_movements_inventory_workspace_fkey
    FOREIGN KEY (inventory_id, user_id)
    REFERENCES public.saas_china_inventory(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT saas_china_inventory_movements_type_check CHECK (
    movement_type IN (
      'opening_balance',
      'arrival',
      'manual_adjustment',
      'shipment_reservation',
      'shipment_release',
      'shipment_dispatch'
    )
  ),
  CONSTRAINT saas_china_inventory_movements_has_delta
    CHECK (on_hand_delta <> 0 OR reserved_delta <> 0),
  CONSTRAINT saas_china_inventory_movements_balances_nonnegative CHECK (
    on_hand_before >= 0
    AND reserved_before >= 0
    AND on_hand_after >= 0
    AND reserved_after >= 0
  ),
  CONSTRAINT saas_china_inventory_movements_on_hand_balance
    CHECK (on_hand_after = on_hand_before + on_hand_delta),
  CONSTRAINT saas_china_inventory_movements_reserved_balance
    CHECK (reserved_after = reserved_before + reserved_delta),
  CONSTRAINT saas_china_inventory_movements_reserved_within_on_hand CHECK (
    reserved_before <= on_hand_before
    AND reserved_after <= on_hand_after
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS saas_china_inventory_movements_user_source_key
  ON public.saas_china_inventory_movements(user_id, source_key);
CREATE INDEX IF NOT EXISTS saas_china_inventory_movements_inventory_occurred
  ON public.saas_china_inventory_movements(inventory_id, occurred_at);
CREATE INDEX IF NOT EXISTS saas_china_inventory_movements_user_occurred
  ON public.saas_china_inventory_movements(user_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.china_outbound_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shipment_no varchar(100) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'draft',
  origin_warehouse_code varchar(100) NOT NULL DEFAULT 'default',
  destination_name text,
  destination_address text,
  forwarder_name varchar(200),
  external_reference varchar(200),
  planned_outbound_date date,
  dispatched_at timestamptz,
  cancelled_at timestamptz,
  memo text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT china_outbound_shipments_id_user_key UNIQUE (id, user_id),
  CONSTRAINT china_outbound_shipments_status_check CHECK (
    status IN ('draft', 'packing', 'ready', 'dispatched', 'cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_shipments_user_shipment_no
  ON public.china_outbound_shipments(user_id, shipment_no);
CREATE INDEX IF NOT EXISTS china_outbound_shipments_user_status_created
  ON public.china_outbound_shipments(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS china_outbound_shipments_user_planned_outbound
  ON public.china_outbound_shipments(user_id, planned_outbound_date);

CREATE TABLE IF NOT EXISTS public.china_outbound_shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL,
  inventory_id uuid NOT NULL,
  user_id uuid NOT NULL,
  sku varchar(100) NOT NULL,
  product_name text NOT NULL,
  option_key varchar(200) NOT NULL DEFAULT '',
  option_name varchar(200),
  reserved_quantity integer NOT NULL,
  packed_quantity integer NOT NULL DEFAULT 0,
  dispatched_quantity integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT china_outbound_shipment_items_id_shipment_user_key
    UNIQUE (id, shipment_id, user_id),
  CONSTRAINT china_outbound_shipment_items_shipment_workspace_fkey
    FOREIGN KEY (shipment_id, user_id)
    REFERENCES public.china_outbound_shipments(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT china_outbound_shipment_items_inventory_workspace_fkey
    FOREIGN KEY (inventory_id, user_id)
    REFERENCES public.saas_china_inventory(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT china_outbound_shipment_items_reserved_positive CHECK (reserved_quantity > 0),
  CONSTRAINT china_outbound_shipment_items_packed_within_reserved CHECK (
    packed_quantity >= 0 AND packed_quantity <= reserved_quantity
  ),
  CONSTRAINT china_outbound_shipment_items_dispatched_within_packed CHECK (
    dispatched_quantity >= 0 AND dispatched_quantity <= packed_quantity
  ),
  CONSTRAINT china_outbound_shipment_items_sort_nonnegative CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_shipment_items_shipment_inventory
  ON public.china_outbound_shipment_items(shipment_id, inventory_id);
CREATE INDEX IF NOT EXISTS china_outbound_shipment_items_inventory
  ON public.china_outbound_shipment_items(inventory_id);
CREATE INDEX IF NOT EXISTS china_outbound_shipment_items_user_inventory
  ON public.china_outbound_shipment_items(user_id, inventory_id);
CREATE INDEX IF NOT EXISTS china_outbound_shipment_items_shipment_sort
  ON public.china_outbound_shipment_items(shipment_id, sort_order);

CREATE TABLE IF NOT EXISTS public.china_outbound_pallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  pallet_no varchar(100) NOT NULL,
  label_code varchar(200),
  sort_order integer NOT NULL DEFAULT 0,
  gross_weight_kg numeric(12, 3),
  length_cm numeric(12, 2),
  width_cm numeric(12, 2),
  height_cm numeric(12, 2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT china_outbound_pallets_id_shipment_user_key
    UNIQUE (id, shipment_id, user_id),
  CONSTRAINT china_outbound_pallets_shipment_workspace_fkey
    FOREIGN KEY (shipment_id, user_id)
    REFERENCES public.china_outbound_shipments(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT china_outbound_pallets_sort_nonnegative CHECK (sort_order >= 0),
  CONSTRAINT china_outbound_pallets_measurements_nonnegative CHECK (
    (gross_weight_kg IS NULL OR gross_weight_kg >= 0)
    AND (length_cm IS NULL OR length_cm >= 0)
    AND (width_cm IS NULL OR width_cm >= 0)
    AND (height_cm IS NULL OR height_cm >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_pallets_shipment_pallet_no
  ON public.china_outbound_pallets(shipment_id, pallet_no);
CREATE INDEX IF NOT EXISTS china_outbound_pallets_shipment_sort
  ON public.china_outbound_pallets(shipment_id, sort_order);
CREATE INDEX IF NOT EXISTS china_outbound_pallets_user_shipment
  ON public.china_outbound_pallets(user_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.china_outbound_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL,
  pallet_id uuid,
  user_id uuid NOT NULL,
  box_no varchar(100) NOT NULL,
  label_code varchar(200),
  status varchar(30) NOT NULL DEFAULT 'open',
  sort_order integer NOT NULL DEFAULT 0,
  gross_weight_kg numeric(12, 3),
  length_cm numeric(12, 2),
  width_cm numeric(12, 2),
  height_cm numeric(12, 2),
  sealed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT china_outbound_boxes_id_shipment_user_key
    UNIQUE (id, shipment_id, user_id),
  CONSTRAINT china_outbound_boxes_shipment_workspace_fkey
    FOREIGN KEY (shipment_id, user_id)
    REFERENCES public.china_outbound_shipments(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT china_outbound_boxes_pallet_shipment_workspace_fkey
    FOREIGN KEY (pallet_id, shipment_id, user_id)
    REFERENCES public.china_outbound_pallets(id, shipment_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT china_outbound_boxes_status_check CHECK (status IN ('open', 'sealed')),
  CONSTRAINT china_outbound_boxes_sort_nonnegative CHECK (sort_order >= 0),
  CONSTRAINT china_outbound_boxes_measurements_nonnegative CHECK (
    (gross_weight_kg IS NULL OR gross_weight_kg >= 0)
    AND (length_cm IS NULL OR length_cm >= 0)
    AND (width_cm IS NULL OR width_cm >= 0)
    AND (height_cm IS NULL OR height_cm >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_boxes_shipment_box_no
  ON public.china_outbound_boxes(shipment_id, box_no);
CREATE INDEX IF NOT EXISTS china_outbound_boxes_shipment_sort
  ON public.china_outbound_boxes(shipment_id, sort_order);
CREATE INDEX IF NOT EXISTS china_outbound_boxes_user_shipment
  ON public.china_outbound_boxes(user_id, shipment_id);
CREATE INDEX IF NOT EXISTS china_outbound_boxes_pallet
  ON public.china_outbound_boxes(pallet_id);

CREATE TABLE IF NOT EXISTS public.china_outbound_box_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  shipment_item_id uuid NOT NULL,
  user_id uuid NOT NULL,
  quantity integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT china_outbound_box_items_box_shipment_workspace_fkey
    FOREIGN KEY (box_id, shipment_id, user_id)
    REFERENCES public.china_outbound_boxes(id, shipment_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT china_outbound_box_items_shipment_item_workspace_fkey
    FOREIGN KEY (shipment_item_id, shipment_id, user_id)
    REFERENCES public.china_outbound_shipment_items(id, shipment_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT china_outbound_box_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT china_outbound_box_items_sort_nonnegative CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_box_items_box_shipment_item
  ON public.china_outbound_box_items(box_id, shipment_item_id);
CREATE INDEX IF NOT EXISTS china_outbound_box_items_shipment_item
  ON public.china_outbound_box_items(shipment_item_id);
CREATE INDEX IF NOT EXISTS china_outbound_box_items_shipment_user
  ON public.china_outbound_box_items(shipment_id, user_id);

ALTER TABLE public.saas_china_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_china_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.china_outbound_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.china_outbound_shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.china_outbound_pallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.china_outbound_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.china_outbound_box_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.saas_china_inventory FROM anon, authenticated;
REVOKE ALL ON TABLE public.saas_china_inventory_movements FROM anon, authenticated;
REVOKE ALL ON TABLE public.china_outbound_shipments FROM anon, authenticated;
REVOKE ALL ON TABLE public.china_outbound_shipment_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.china_outbound_pallets FROM anon, authenticated;
REVOKE ALL ON TABLE public.china_outbound_boxes FROM anon, authenticated;
REVOKE ALL ON TABLE public.china_outbound_box_items FROM anon, authenticated;
