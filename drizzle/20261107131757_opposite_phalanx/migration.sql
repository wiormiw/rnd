CREATE TYPE "action_item_status" AS ENUM('PENDING', 'DONE');--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"card_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "action_item_status" DEFAULT 'PENDING'::"action_item_status" NOT NULL,
	"spawned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"topic_id" uuid NOT NULL,
	"memo_id" uuid,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"estimated_minutes" integer DEFAULT 2 NOT NULL,
	"priority_weight" real DEFAULT 1 NOT NULL,
	"sm_interval" integer DEFAULT 0 NOT NULL,
	"sm_repetition" integer DEFAULT 0 NOT NULL,
	"sm_ease_factor" real DEFAULT 2.5 NOT NULL,
	"next_review_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_estimated_minutes_min" CHECK ("estimated_minutes" >= 1),
	CONSTRAINT "cards_priority_weight_positive" CHECK ("priority_weight" > 0),
	CONSTRAINT "cards_sm_ease_factor_min" CHECK ("sm_ease_factor" >= 1.3)
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"card_id" uuid NOT NULL,
	"quality_score" integer NOT NULL,
	"time_spent_seconds" integer NOT NULL,
	"previous_interval" integer NOT NULL,
	"new_interval" integer NOT NULL,
	"previous_ease_factor" real NOT NULL,
	"new_ease_factor" real NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_logs_quality_score_range" CHECK ("quality_score" between 0 and 5),
	CONSTRAINT "review_logs_time_spent_non_negative" CHECK ("time_spent_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "topic_prerequisites" (
	"topic_id" uuid,
	"prerequisite_id" uuid,
	CONSTRAINT "topic_prerequisites_pkey" PRIMARY KEY("topic_id","prerequisite_id"),
	CONSTRAINT "topic_prerequisites_no_self" CHECK ("topic_id" <> "prerequisite_id")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memos" ADD COLUMN "topic_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "action_items_one_pending_per_card" ON "action_items" ("card_id") WHERE "status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "action_items_status_idx" ON "action_items" ("status");--> statement-breakpoint
CREATE INDEX "cards_next_review_at_idx" ON "cards" ("next_review_at");--> statement-breakpoint
CREATE INDEX "cards_topic_id_idx" ON "cards" ("topic_id");--> statement-breakpoint
CREATE INDEX "memos_topic_id_idx" ON "memos" ("topic_id");--> statement-breakpoint
CREATE INDEX "review_logs_card_id_reviewed_at_idx" ON "review_logs" ("card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "topic_prerequisites_prerequisite_id_idx" ON "topic_prerequisites" ("prerequisite_id");--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_topic_id_topics_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_memo_id_memos_id_fkey" FOREIGN KEY ("memo_id") REFERENCES "memos"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "memos" ADD CONSTRAINT "memos_topic_id_topics_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "topic_prerequisites" ADD CONSTRAINT "topic_prerequisites_topic_id_topics_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "topic_prerequisites" ADD CONSTRAINT "topic_prerequisites_prerequisite_id_topics_id_fkey" FOREIGN KEY ("prerequisite_id") REFERENCES "topics"("id") ON DELETE CASCADE;