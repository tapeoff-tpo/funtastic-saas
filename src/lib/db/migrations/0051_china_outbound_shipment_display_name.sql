-- User-facing task labels are intentionally nullable and non-unique. The
-- existing shipment_no remains the immutable operational identifier.
ALTER TABLE china_outbound_shipments
  ADD COLUMN IF NOT EXISTS display_name varchar(200);
