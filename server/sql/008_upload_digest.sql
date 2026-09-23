BEGIN;
ALTER TABLE integration_uploaded_files ADD COLUMN IF NOT EXISTS content_sha256 char(64);
COMMIT;
