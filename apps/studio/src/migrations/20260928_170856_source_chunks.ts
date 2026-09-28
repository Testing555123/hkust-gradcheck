import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "source_chunks" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"program_key" varchar NOT NULL,
  	"chunk_id" varchar NOT NULL,
  	"page" numeric NOT NULL,
  	"ordinal" numeric NOT NULL,
  	"char_start" numeric,
  	"char_end" numeric,
  	"source_pdf" varchar,
  	"text" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_chunks_id" integer;
  CREATE INDEX "source_chunks_program_key_idx" ON "source_chunks" USING btree ("program_key");
  CREATE UNIQUE INDEX "source_chunks_chunk_id_idx" ON "source_chunks" USING btree ("chunk_id");
  CREATE INDEX "source_chunks_updated_at_idx" ON "source_chunks" USING btree ("updated_at");
  CREATE INDEX "source_chunks_created_at_idx" ON "source_chunks" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_chunks_fk" FOREIGN KEY ("source_chunks_id") REFERENCES "public"."source_chunks"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_source_chunks_id_idx" ON "payload_locked_documents_rels" USING btree ("source_chunks_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_chunks" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "source_chunks" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_chunks_fk";
  
  DROP INDEX "payload_locked_documents_rels_source_chunks_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_chunks_id";`)
}
