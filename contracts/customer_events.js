// Shared wire vocabulary. Authorization and scoring remain server-side.
export const CUSTOMER_EVENT_TYPES = Object.freeze([
  'activity.item_added',
  'event.source_url_updated',
  'report.whitelist_penalty',
  'report.submitted',
  'report.intelligence_generated',
  'rogue.evidence_logged',
  'automation.scan_started',
  'automation.platform_outcome',
  'automation.row_status_changed',
  'automation.scan_completed',
  'platform.report_outcome'
]);

export const CUSTOMER_EVENT_ATTRIBUTE_KEYS = Object.freeze({
  'activity.item_added': ['platform', 'target_url', 'source_event_name', 'vertical'],
  'event.source_url_updated': ['platform', 'target_url', 'source_event_name', 'vertical'],
  'report.whitelist_penalty': ['platform', 'target_url', 'handle', 'source_event_name', 'vertical', 'scout_points'],
  'report.submitted': [
    'platform', 'urls', 'handle', 'source_event_name', 'vertical', 'report_id', 'mode',
    'url_count', 'estimated_views', 'scout_points', 'enforcer_points', 'pdf_url',
    'channel_url', 'content_type'
  ],
  'report.intelligence_generated': ['start_date', 'end_date', 'pdf_url'],
  'rogue.evidence_logged': [
    'target_url', 'domain', 'notes', 'evidence_url', 'network_observation_count',
    'embedded_video_count', 'iframe_count', 'email_count'
  ],
  'automation.scan_started': ['run_id', 'start_row', 'duration_ms'],
  'automation.platform_outcome': ['run_id', 'platform', 'target_url', 'outcome', 'row_index'],
  'automation.row_status_changed': [
    'run_id', 'row_index', 'previous_status', 'new_status', 'resolved_count',
    'active_count', 'enforcer_points'
  ],
  'automation.scan_completed': [
    'run_id', 'outcome', 'checked_count', 'resolved_count', 'active_count',
    'duration_ms', 'reason'
  ],
  'platform.report_outcome': [
    'platform', 'outcome', 'report_id', 'source_event_name', 'vertical', 'url_count', 'reason'
  ]
});

