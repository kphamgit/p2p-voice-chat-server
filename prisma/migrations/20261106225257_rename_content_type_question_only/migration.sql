-- Rename ContentType value `question_only` → `question`, in place, so existing
-- `question_only` items become `question`.
ALTER TYPE "ContentType" RENAME VALUE 'question_only' TO 'question';
