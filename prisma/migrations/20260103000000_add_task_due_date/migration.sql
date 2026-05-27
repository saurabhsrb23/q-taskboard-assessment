-- AlterTable: add optional due_date column to tasks
-- Nullable so all existing tasks are unaffected.
ALTER TABLE "tasks" ADD COLUMN "due_date" TIMESTAMP(3);
