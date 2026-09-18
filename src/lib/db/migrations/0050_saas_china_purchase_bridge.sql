-- Links opt-in purchase rows to the isolated SaaS China inventory/outbound
-- ledger from 0049. Legacy Ecount/raw China inventory is intentionally not
-- referenced here.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_request_items_id_user
  ON purchase_request_items(id, user_id);

CREATE TABLE IF NOT EXISTS saas_china_purchase_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  inventory_id uuid NOT NULL,
  purchase_request_item_id uuid NOT NULL,
  received_quantity integer NOT NULL DEFAULT 0,
  reserved_quantity integer NOT NULL DEFAULT 0,
  dispatched_quantity integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_china_purchase_links_id_user_key UNIQUE (id, user_id),
  CONSTRAINT saas_china_purchase_links_inventory_workspace_fkey
    FOREIGN KEY (inventory_id, user_id)
    REFERENCES saas_china_inventory(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT saas_china_purchase_links_purchase_item_workspace_fkey
    FOREIGN KEY (purchase_request_item_id, user_id)
    REFERENCES purchase_request_items(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT saas_china_purchase_links_received_nonnegative
    CHECK (received_quantity >= 0),
  CONSTRAINT saas_china_purchase_links_reserved_nonnegative
    CHECK (reserved_quantity >= 0),
  CONSTRAINT saas_china_purchase_links_dispatched_nonnegative
    CHECK (dispatched_quantity >= 0),
  CONSTRAINT saas_china_purchase_links_allocation_within_received
    CHECK (reserved_quantity + dispatched_quantity <= received_quantity)
);

CREATE UNIQUE INDEX IF NOT EXISTS saas_china_purchase_links_user_purchase_item
  ON saas_china_purchase_links(user_id, purchase_request_item_id);
CREATE INDEX IF NOT EXISTS saas_china_purchase_links_user_inventory_created
  ON saas_china_purchase_links(user_id, inventory_id, created_at, id);

CREATE TABLE IF NOT EXISTS saas_china_shipment_purchase_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  shipment_item_id uuid NOT NULL,
  purchase_link_id uuid NOT NULL,
  reserved_quantity integer NOT NULL,
  dispatched_quantity integer NOT NULL DEFAULT 0,
  released_quantity integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_china_shipment_purchase_allocations_shipment_workspace_fkey
    FOREIGN KEY (shipment_id, user_id)
    REFERENCES china_outbound_shipments(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT saas_china_shipment_purchase_allocations_shipment_item_workspace_fkey
    FOREIGN KEY (shipment_item_id, shipment_id, user_id)
    REFERENCES china_outbound_shipment_items(id, shipment_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT saas_china_shipment_purchase_allocations_purchase_link_workspace_fkey
    FOREIGN KEY (purchase_link_id, user_id)
    REFERENCES saas_china_purchase_links(id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT saas_china_shipment_purchase_allocations_reserved_positive
    CHECK (reserved_quantity > 0),
  CONSTRAINT saas_china_shipment_purchase_allocations_dispatched_nonnegative
    CHECK (dispatched_quantity >= 0),
  CONSTRAINT saas_china_shipment_purchase_allocations_released_nonnegative
    CHECK (released_quantity >= 0),
  CONSTRAINT saas_china_shipment_purchase_allocations_resolved_within_reserved
    CHECK (dispatched_quantity + released_quantity <= reserved_quantity)
);

CREATE UNIQUE INDEX IF NOT EXISTS saas_china_shipment_purchase_allocations_item_link
  ON saas_china_shipment_purchase_allocations(shipment_item_id, purchase_link_id);
CREATE INDEX IF NOT EXISTS saas_china_shipment_purchase_allocations_user_shipment
  ON saas_china_shipment_purchase_allocations(user_id, shipment_id);
CREATE INDEX IF NOT EXISTS saas_china_shipment_purchase_allocations_purchase_link
  ON saas_china_shipment_purchase_allocations(purchase_link_id);

ALTER TABLE saas_china_purchase_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_china_shipment_purchase_allocations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE saas_china_purchase_links FROM anon, authenticated;
REVOKE ALL ON TABLE saas_china_shipment_purchase_allocations FROM anon, authenticated;
