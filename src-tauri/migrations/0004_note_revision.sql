-- 笔记的历史版本。
--
-- 0001 里建过一张叫 note_history 的表，当时没有任何代码写它读它，0002 就把那张
-- 空表删了。现在真要做这件事，按实际用得到的样子重建，并换个名字，免得跟那次
-- 清理混在一起看不清谁是谁。
--
-- 正文仍然以文件为唯一事实源：这张表只在**覆盖之前**留一份旧稿，不参与任何读取
-- 路径。它兜住的是「改坏了还存了盘」这一种事故——删除有系统回收站，外部改动有
-- 冲突提示，只有覆盖是不可逆的。
CREATE TABLE IF NOT EXISTS note_revision (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id       INTEGER NOT NULL REFERENCES note(id) ON DELETE CASCADE,
    content       TEXT    NOT NULL,
    -- 与 note.content_hash 同一套（`services::hash_content_lf`，行尾归一化后再算）。
    -- 只用于去重：自动保存每几百毫秒就调一次，正文没动的那些调用不该堆出一串
    -- 一模一样的历史。
    revision_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_revision_note ON note_revision (note_id, created_at DESC);
