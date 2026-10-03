BEGIN;
-- Deploy with report writes paused. Keep legacy reservations and add stable-ID
-- reservations, so historical reports cannot earn credit again after the change.
LOCK TABLE reported_targets IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE tiktok_target_backfill ON COMMIT DROP AS
SELECT DISTINCT t.customer_id, t.work_key, t.report_id, item->>'url' AS url,
  (regexp_match(CASE WHEN resolved->>'sourceUrl'=item->>'url' THEN resolved->>'resolvedUrl' ELSE item->>'url' END,
    '^https?://(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\.?(?::(?:80|443))?/(?:@[^/]+/video|share/video|embed/v2|player/v1)/([1-9][0-9]{0,19})/?(?:[?#].*)?$', 'i'))[1] AS video_id
FROM reported_targets t
JOIN generated_reports g ON g.customer_id=t.customer_id AND g.report_id=t.report_id
CROSS JOIN LATERAL jsonb_array_elements(g.report_data->'items') WITH ORDINALITY AS items(item, position)
CROSS JOIN LATERAL (SELECT g.report_data->'policy'->'tiktokTargets'->(position::integer - 1) AS resolved) AS identity
WHERE g.report_data->'policy'->>'platform'='tiktok'
  OR item->>'url' ~* '^https?://([^/?#]+\.)?(tiktok\.com|tiktokforbusiness\.com)\.?(?::[0-9]+)?/';

-- Short links have no offline identity. Do not silently release a deployment
-- with historical holes: reconcile these reports before retrying the migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tiktok_target_backfill WHERE video_id IS NULL OR video_id::numeric > 18446744073709551615) THEN
    RAISE EXCEPTION 'Historical TikTok targets require identity reconciliation before migration 014; inspect accepted generated_reports URLs.';
  END IF;
END $$;

INSERT INTO reported_targets(customer_id,work_key,target_key,report_id)
SELECT customer_id,work_key,encode(sha256(convert_to('tiktok:' || video_id, 'UTF8')), 'hex'),report_id
FROM tiktok_target_backfill
ORDER BY customer_id,work_key,report_id
ON CONFLICT DO NOTHING;
COMMIT;
