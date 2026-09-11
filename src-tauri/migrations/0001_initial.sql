-- 轻鉴 · 初始数据库结构
-- 说明：Markdown 正文以文件为唯一事实源落盘，本库只保存元数据、标签、
-- 版本快照、全文索引与用户设置。

PRAGMA foreign_keys = ON;

-- 工作区：用户选择的一个本地文件夹
CREATE TABLE IF NOT EXISTS workspace (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    root_path      TEXT    NOT NULL UNIQUE,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    last_opened_at INTEGER
);

-- 笔记：对应工作区内的一个 .md 文件，正文不落库
CREATE TABLE IF NOT EXISTS note (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    rel_path     TEXT    NOT NULL,
    title        TEXT    NOT NULL DEFAULT '',
    content_hash TEXT,
    pinned       INTEGER NOT NULL DEFAULT 0,
    is_deleted   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (workspace_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_note_workspace ON note (workspace_id, is_deleted);

-- 版本快照：手动 / 定时保存时写入
CREATE TABLE IF NOT EXISTS note_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id    INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
    content    TEXT    NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_history_note ON note_history (note_id, created_at DESC);

-- 标签
CREATE TABLE IF NOT EXISTS tag (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT    NOT NULL UNIQUE,
    color TEXT
);

CREATE TABLE IF NOT EXISTS note_tag (
    note_id INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

-- 用户设置：键值对，值统一以 JSON 文本存储
CREATE TABLE IF NOT EXISTS setting (
    key        TEXT PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 全文索引（FTS5）
-- 注意：SQLite 的 unicode61 分词器不会切分中文，因此写入前必须先用
-- `search::to_index_text` 把 CJK 逐字拆开，查询侧用 `to_match_query`
-- 生成短语查询，否则中文子串搜索永远匹配不上。
CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5 (
    note_id UNINDEXED,
    title,
    content,
    -- 原文副本，仅用于生成搜索摘要，不参与索引
    raw UNINDEXED,
    rel_path UNINDEXED,
    tokenize = 'unicode61'
);
