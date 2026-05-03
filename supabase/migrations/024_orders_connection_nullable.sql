-- Historical/manual imports do not always have a live marketplace connection.
ALTER TABLE orders
  ALTER COLUMN connection_id DROP NOT NULL;
