-- Migration 001: add from_circle flag to whispers
-- Run: wrangler d1 execute whisper --remote --file=d1/migrations/001_from_circle.sql
ALTER TABLE whispers ADD COLUMN from_circle INTEGER NOT NULL DEFAULT 0;
