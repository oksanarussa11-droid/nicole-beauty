


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."ms_fill_for_new_master"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into master_services (master_id, service_id, price, commission_master_pct)
  select NEW.id, s.id, 0, 50
  from services s
  on conflict (master_id, service_id) do nothing;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."ms_fill_for_new_master"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ms_fill_for_new_service"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into master_services (master_id, service_id, price, commission_master_pct)
  select m.id, NEW.id, 0, 50
  from masters m
  on conflict (master_id, service_id) do nothing;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."ms_fill_for_new_service"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attendances" (
    "id" bigint NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "time" time without time zone,
    "master_id" bigint NOT NULL,
    "service_id" bigint,
    "service_name" "text",
    "price" numeric(12,2) NOT NULL,
    "master_pay" numeric(12,2) DEFAULT 0 NOT NULL,
    "commission_pct" numeric(5,2),
    "client_name" "text",
    "payment_method" "text",
    "source" "text" DEFAULT 'pro_form'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uses_salon_products" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."attendances" OWNER TO "postgres";


COMMENT ON COLUMN "public"."attendances"."uses_salon_products" IS 'true = salon-provided products were used (lower commission rate); false = master used own products (higher rate).';



CREATE SEQUENCE IF NOT EXISTS "public"."attendances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."attendances_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."attendances_id_seq" OWNED BY "public"."attendances"."id";



CREATE TABLE IF NOT EXISTS "public"."day_summaries" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "master_id" bigint NOT NULL,
    "revenue" numeric(12,2) DEFAULT 0 NOT NULL,
    "master_pay" numeric(12,2) DEFAULT 0 NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."day_summaries" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."day_summaries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."day_summaries_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."day_summaries_id_seq" OWNED BY "public"."day_summaries"."id";



CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "supplier" "text",
    "status" "text" DEFAULT 'Не оплачено'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."expenses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."expenses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."expenses_id_seq" OWNED BY "public"."expenses"."id";



CREATE TABLE IF NOT EXISTS "public"."income" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "method" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."income" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."income_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."income_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."income_id_seq" OWNED BY "public"."income"."id";



CREATE TABLE IF NOT EXISTS "public"."inventory" (
    "id" bigint NOT NULL,
    "brand" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."inventory" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."inventory_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."inventory_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."inventory_id_seq" OWNED BY "public"."inventory"."id";



CREATE TABLE IF NOT EXISTS "public"."master_services" (
    "id" bigint NOT NULL,
    "master_id" bigint NOT NULL,
    "service_id" bigint NOT NULL,
    "price" numeric(12,2) DEFAULT 0 NOT NULL,
    "commission_master_pct" numeric(5,2) DEFAULT 50 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "commission_master_pct_salon" numeric(5,2) DEFAULT 40 NOT NULL
);


ALTER TABLE "public"."master_services" OWNER TO "postgres";


COMMENT ON COLUMN "public"."master_services"."commission_master_pct" IS 'Master share (0–100) when master uses OWN products. Higher of the two rates.';



COMMENT ON COLUMN "public"."master_services"."commission_master_pct_salon" IS 'Master share (0–100) when master uses SALON-provided products. Lower of the two rates.';



CREATE SEQUENCE IF NOT EXISTS "public"."master_services_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."master_services_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."master_services_id_seq" OWNED BY "public"."master_services"."id";



CREATE TABLE IF NOT EXISTS "public"."masters" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "specialty" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pin_hash" "text"
);


ALTER TABLE "public"."masters" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."masters_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."masters_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."masters_id_seq" OWNED BY "public"."masters"."id";



CREATE OR REPLACE VIEW "public"."masters_public" AS
 SELECT "id",
    "name",
    "specialty",
    "active",
    "created_at"
   FROM "public"."masters";


ALTER VIEW "public"."masters_public" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pin_attempts" (
    "id" bigint NOT NULL,
    "master_id" bigint,
    "ip" "text",
    "success" boolean NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pin_attempts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pin_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pin_attempts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pin_attempts_id_seq" OWNED BY "public"."pin_attempts"."id";



CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."services_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."services_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."services_id_seq" OWNED BY "public"."services"."id";



ALTER TABLE ONLY "public"."attendances" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."attendances_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."day_summaries" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."day_summaries_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."expenses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."expenses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."income" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."income_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."inventory" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."inventory_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."master_services" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."master_services_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."masters" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."masters_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pin_attempts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pin_attempts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."services" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."services_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."attendances"
    ADD CONSTRAINT "attendances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."day_summaries"
    ADD CONSTRAINT "day_summaries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income"
    ADD CONSTRAINT "income_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory"
    ADD CONSTRAINT "inventory_brand_name_key" UNIQUE ("brand", "name");



ALTER TABLE ONLY "public"."inventory"
    ADD CONSTRAINT "inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_services"
    ADD CONSTRAINT "master_services_master_id_service_id_key" UNIQUE ("master_id", "service_id");



ALTER TABLE ONLY "public"."master_services"
    ADD CONSTRAINT "master_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."masters"
    ADD CONSTRAINT "masters_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."masters"
    ADD CONSTRAINT "masters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pin_attempts"
    ADD CONSTRAINT "pin_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



CREATE INDEX "attendances_date_idx" ON "public"."attendances" USING "btree" ("date");



CREATE INDEX "attendances_master_idx" ON "public"."attendances" USING "btree" ("master_id");



CREATE INDEX "day_summaries_date_idx" ON "public"."day_summaries" USING "btree" ("date");



CREATE INDEX "day_summaries_master_idx" ON "public"."day_summaries" USING "btree" ("master_id");



CREATE INDEX "expenses_date_idx" ON "public"."expenses" USING "btree" ("date");



CREATE INDEX "income_date_idx" ON "public"."income" USING "btree" ("date");



CREATE INDEX "pin_attempts_master_ts_idx" ON "public"."pin_attempts" USING "btree" ("master_id", "attempted_at" DESC);



CREATE OR REPLACE TRIGGER "trg_ms_fill_for_new_master" AFTER INSERT ON "public"."masters" FOR EACH ROW EXECUTE FUNCTION "public"."ms_fill_for_new_master"();



CREATE OR REPLACE TRIGGER "trg_ms_fill_for_new_service" AFTER INSERT ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."ms_fill_for_new_service"();



ALTER TABLE ONLY "public"."attendances"
    ADD CONSTRAINT "attendances_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."attendances"
    ADD CONSTRAINT "attendances_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."day_summaries"
    ADD CONSTRAINT "day_summaries_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."master_services"
    ADD CONSTRAINT "master_services_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."master_services"
    ADD CONSTRAINT "master_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_attempts"
    ADD CONSTRAINT "pin_attempts_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE SET NULL;



CREATE POLICY "anon_all_day_summaries" ON "public"."day_summaries" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_expenses" ON "public"."expenses" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_income" ON "public"."income" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_inventory" ON "public"."inventory" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_master_services" ON "public"."master_services" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_masters" ON "public"."masters" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_all_services" ON "public"."services" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "anon_select_attendances" ON "public"."attendances" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."attendances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authed_all_day_summaries" ON "public"."day_summaries" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authed_all_expenses" ON "public"."expenses" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authed_all_income" ON "public"."income" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authed_all_inventory" ON "public"."inventory" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authed_all_master_services" ON "public"."master_services" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authed_all_masters" ON "public"."masters" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authed_all_services" ON "public"."services" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authed_select_attendances" ON "public"."attendances" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."day_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."income" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."master_services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."masters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pin_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."ms_fill_for_new_master"() TO "anon";
GRANT ALL ON FUNCTION "public"."ms_fill_for_new_master"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ms_fill_for_new_master"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ms_fill_for_new_service"() TO "anon";
GRANT ALL ON FUNCTION "public"."ms_fill_for_new_service"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ms_fill_for_new_service"() TO "service_role";



GRANT ALL ON TABLE "public"."attendances" TO "anon";
GRANT ALL ON TABLE "public"."attendances" TO "authenticated";
GRANT ALL ON TABLE "public"."attendances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."attendances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."attendances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."attendances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."day_summaries" TO "anon";
GRANT ALL ON TABLE "public"."day_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."day_summaries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."day_summaries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."day_summaries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."day_summaries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."income" TO "anon";
GRANT ALL ON TABLE "public"."income" TO "authenticated";
GRANT ALL ON TABLE "public"."income" TO "service_role";



GRANT ALL ON SEQUENCE "public"."income_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."income_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."income_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."inventory" TO "anon";
GRANT ALL ON TABLE "public"."inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory" TO "service_role";



GRANT ALL ON SEQUENCE "public"."inventory_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."inventory_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."inventory_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."master_services" TO "anon";
GRANT ALL ON TABLE "public"."master_services" TO "authenticated";
GRANT ALL ON TABLE "public"."master_services" TO "service_role";



GRANT ALL ON SEQUENCE "public"."master_services_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."master_services_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."master_services_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."masters" TO "anon";
GRANT ALL ON TABLE "public"."masters" TO "authenticated";
GRANT ALL ON TABLE "public"."masters" TO "service_role";



GRANT ALL ON SEQUENCE "public"."masters_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."masters_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."masters_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."masters_public" TO "anon";
GRANT ALL ON TABLE "public"."masters_public" TO "authenticated";
GRANT ALL ON TABLE "public"."masters_public" TO "service_role";



GRANT ALL ON TABLE "public"."pin_attempts" TO "anon";
GRANT ALL ON TABLE "public"."pin_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."pin_attempts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pin_attempts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pin_attempts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pin_attempts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON SEQUENCE "public"."services_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."services_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."services_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







