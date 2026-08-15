-- 共享词库表: (语言桶, 原文) 唯一; 先到先得(INSERT OR IGNORE)
-- lang = 目标语言(英文源, 兼容旧客户端) 或 目标-源 (zh-CN-ja / zh-CN-id)
CREATE TABLE IF NOT EXISTS entries (
  lang  TEXT    NOT NULL,          -- zh-CN / zh-TW / zh-CN-ja / zh-CN-id
  k     TEXT    NOT NULL,          -- 原文(已归一化, 与客户端查表 key 完全一致)
  v     TEXT    NOT NULL,          -- 译文
  model TEXT,                      -- 产出该译文的服务商/模型(留作以后升级覆盖)
  ts    INTEGER NOT NULL,          -- 入库时间(unix 毫秒), 增量拉取游标
  PRIMARY KEY (lang, k)
);
CREATE INDEX IF NOT EXISTS idx_lang_ts ON entries(lang, ts);
