-- Credentials, kept apart from the setting table on purpose.
--
-- load_settings returns every row of setting to the frontend, so a token stored
-- there would be readable by the webview. No command exposes this table: the
-- upload path reads the token in Rust and it never leaves the process.
CREATE TABLE IF NOT EXISTS secret (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
