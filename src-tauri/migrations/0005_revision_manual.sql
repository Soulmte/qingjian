-- 手动钉住的版本。
--
-- 自动留档有一个时间闸门（同一篇隔至少 5 分钟才记一版）：它回答的是「我想回到
-- 动手之前」，所以粗粒度就够，逐次留档反而会把真正有用的版本挤出上限。而「我马上
-- 要大改，先把现在这版钉住」是另一个需求——必须立刻生效，而且不能被裁剪掉。
ALTER TABLE note_revision ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0;
