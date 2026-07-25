-- 共享词库表: (语言, 英文原文) 唯一; 先到先得(INSERT OR IGNORE)
CREATE TABLE IF NOT EXISTS entries (
  lang  TEXT    NOT NULL,          -- 目标语言, 如 zh-CN / zh-TW
  k     TEXT    NOT NULL,          -- 英文原文(已归一化, 与客户端查表 key 完全一致)
  v     TEXT    NOT NULL,          -- 译文
  model TEXT,                      -- 产出该译文的服务商/模型(留作以后升级覆盖)
  ts    INTEGER NOT NULL,          -- 入库时间(unix 毫秒), 增量拉取游标
  PRIMARY KEY (lang, k)
);
CREATE INDEX IF NOT EXISTS idx_lang_ts ON entries(lang, ts);
