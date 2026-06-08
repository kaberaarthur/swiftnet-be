-- Run this migration before deploying the user soft-delete feature
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;
