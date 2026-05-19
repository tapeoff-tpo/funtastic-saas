CREATE TABLE IF NOT EXISTS "order_change_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "actor_id" uuid,
  "action" varchar(80) NOT NULL,
  "title" varchar(200) NOT NULL,
  "description" text,
  "before" jsonb,
  "after" jsonb,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_change_logs" ADD CONSTRAINT "order_change_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_change_logs_order_created" ON "order_change_logs" USING btree ("order_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_change_logs_user_created" ON "order_change_logs" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_change_logs_action_created" ON "order_change_logs" USING btree ("action", "created_at");
