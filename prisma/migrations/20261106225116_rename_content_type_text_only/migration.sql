-- Rename ContentType value `text_only` → `instructions_only`. Renaming in place
-- (Postgres 10+) keeps existing rows: any `text_only` item becomes `instructions_only`.
ALTER TYPE "ContentType" RENAME VALUE 'text_only' TO 'instructions_only';
