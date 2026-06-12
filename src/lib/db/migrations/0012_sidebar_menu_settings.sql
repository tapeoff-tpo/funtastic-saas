CREATE TABLE IF NOT EXISTS "sidebar_menu_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "menu_order" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sidebar_menu_settings_user_id"
ON "sidebar_menu_settings" USING btree ("user_id");
