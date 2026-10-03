CREATE TYPE "public"."fund_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."share_kind" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "fund_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_date" date NOT NULL,
	"direction" "fund_direction" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"project_id" text,
	"payment_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_shares" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "share_kind" NOT NULL,
	"basis_points" integer,
	"amount" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_shares_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "source_payment_id" text;--> statement-breakpoint
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fund_entries_entry_date_index" ON "fund_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_entries_payment_id_index" ON "fund_entries" USING btree ("payment_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_source_payment_id_payments_id_fk" FOREIGN KEY ("source_payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_source_payment_id_index" ON "payments" USING btree ("source_payment_id");