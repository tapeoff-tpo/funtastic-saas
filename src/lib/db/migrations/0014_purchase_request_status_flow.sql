ALTER TYPE "purchase_request_status" RENAME VALUE 'china_arrived' TO 'outbound_requested';
--> statement-breakpoint
ALTER TYPE "purchase_request_status" RENAME VALUE 'purchasing' TO 'china_arrived';
--> statement-breakpoint
ALTER TYPE "purchase_request_status" RENAME VALUE 'planned' TO 'purchased';
--> statement-breakpoint
ALTER TYPE "purchase_request_status" RENAME VALUE 'cancelled' TO 'completed';
