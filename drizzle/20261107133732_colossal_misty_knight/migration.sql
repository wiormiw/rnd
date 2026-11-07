ALTER TABLE "cards" ALTER COLUMN "priority_weight" SET DATA TYPE double precision USING "priority_weight"::double precision;--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "sm_ease_factor" SET DATA TYPE double precision USING "sm_ease_factor"::double precision;--> statement-breakpoint
ALTER TABLE "review_logs" ALTER COLUMN "previous_ease_factor" SET DATA TYPE double precision USING "previous_ease_factor"::double precision;--> statement-breakpoint
ALTER TABLE "review_logs" ALTER COLUMN "new_ease_factor" SET DATA TYPE double precision USING "new_ease_factor"::double precision;