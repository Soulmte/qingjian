-- The note_history, tag and note_tag tables were created by the first migration
-- but never used: nothing ever inserted or read a row, and the delete dialog
-- used to promise that "history snapshots" were kept, which was untrue.
-- Dropping them keeps the schema honest about what the app actually does.
--
-- Nothing is lost. A row was never written, so these tables are empty in every
-- existing database.

DROP INDEX IF EXISTS idx_history_note;
DROP TABLE IF EXISTS note_tag;
DROP TABLE IF EXISTS tag;
DROP TABLE IF EXISTS note_history;
