CREATE TYPE "public"."currency" AS ENUM('EUR', 'ALL', 'USD');--> statement-breakpoint
CREATE TYPE "public"."payment_direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('lead', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recurrence_interval" AS ENUM('weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('team', 'client');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_users" (
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "client_users_client_id_user_id_pk" PRIMARY KEY("client_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"nipt" text,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"user_id" text,
	"counterparty" text,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"due_date" date NOT NULL,
	"paid_on" date,
	"method" text,
	"reference" text,
	"recurring_plan_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"visibility" "visibility" DEFAULT 'team' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"visibility" "visibility" DEFAULT 'team' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "project_status" DEFAULT 'lead' NOT NULL,
	"description" text,
	"start_date" date,
	"due_date" date,
	"budget" bigint,
	"currency" "currency" DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"user_id" text,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"interval" "recurrence_interval" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"next_due_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recurring_plan_id_recurring_plans_id_fk" FOREIGN KEY ("recurring_plan_id") REFERENCES "public"."recurring_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_index" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_entity_id_index" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "client_users_user_id_index" ON "client_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_project_id_index" ON "payments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "payments_user_id_index" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_status_due_date_index" ON "payments" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_recurring_plan_id_due_date_index" ON "payments" USING btree ("recurring_plan_id","due_date");--> statement-breakpoint
CREATE INDEX "project_links_project_id_index" ON "project_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_members_user_id_index" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_notes_project_id_index" ON "project_notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_client_id_index" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_status_index" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recurring_plans_project_id_index" ON "recurring_plans" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "recurring_plans_active_next_due_date_index" ON "recurring_plans" USING btree ("active","next_due_date");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_index" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_index" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "verification_identifier_index" ON "verification" USING btree ("identifier");