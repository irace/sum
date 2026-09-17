CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"institution" text,
	"last4" text,
	"connection_status" text,
	"capabilities" jsonb NOT NULL,
	"granted_actions" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_user_id_source_id_pk" PRIMARY KEY("user_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "auth_flows" (
	"hash" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"next_poll_at" timestamp with time zone NOT NULL,
	"interval" integer NOT NULL,
	"expected_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"user_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "balances_user_id_source_id_pk" PRIMARY KEY("user_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encrypted" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"needs_reconnect" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"transactions_fetched" integer DEFAULT 0 NOT NULL,
	"message" text,
	"history_complete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"user_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_id" text,
	"date" text NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"category" text,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transactions_user_id_external_id_pk" PRIMARY KEY("user_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_flows" ADD CONSTRAINT "auth_flows_expected_user_id_users_id_fk" FOREIGN KEY ("expected_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_states" ADD CONSTRAINT "sync_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date","external_id");--> statement-breakpoint
CREATE INDEX "transactions_user_source_idx" ON "transactions" USING btree ("user_id","source_id");