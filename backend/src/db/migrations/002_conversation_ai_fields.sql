-- Migration 002 – AI classification and draft on conversations (Phase 4)

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_classification TEXT,
  ADD COLUMN IF NOT EXISTS ai_draft          TEXT;
