-- =============================================================================
-- Tech Event Discover · R1-MUST Event Validation Trigger Security Fix
-- Ensures private.trg_validate_event_invariants executes as SECURITY DEFINER
-- (matching adjacent private validation triggers) so non-owner roles do not
-- require direct USAGE on schema private when writing to public.events.
-- =============================================================================

BEGIN;

ALTER FUNCTION private.trg_validate_event_invariants() SECURITY DEFINER;

COMMIT;
