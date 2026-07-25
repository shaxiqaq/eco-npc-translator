# ECO 共享 NPC 词库节点 (Cloudflare Workers + D1)

每个客户端翻出的新 `英文→中文` 自动上报这里，别人自动拉走。免费、不休眠、无需信用卡。

## 一次性部署（约 5 分钟）

> 需要 Node.js（`node -v` 能输出版本即可）。所有命令在本文件夹 `dict_node/` 下运行。

```bash
# 1. 装 Cloudflare 命令行
npm install -g wrangler

# 2. 登录（会弹浏览器授权，免费账号即可，不用绑卡）
wrangler login

# 3. 创建 D1 数据库 —— 把输出里的 database_id 填进 wrangler.toml
wrangler d1 create eco-npc-dict

# 4. 建表
wrangler d1 execute eco-npc-dict --remote --file=./schema.sql

# 5. 设置读写口令（随便起一串，记下来，等下要填进客户端）
wrangler secret put TOKEN
#   终端会提示输入，粘贴你的口令回车

# 6. 部署
wrangler deploy
```

部署成功后终端会打印一个网址，形如：
```
https://eco-npc-dict.<你的子域>.workers.dev
```
**把这个网址 + 你设的 TOKEN 一起回贴给我**，我接到客户端里。

## 自检

```bash
# 应返回 {"ok":true,...}
curl https://eco-npc-dict.<你的子域>.workers.dev/

# 上报一条测试
curl -X POST https://eco-npc-dict.<你的子域>.workers.dev/contribute \
  -H "Content-Type: application/json" \
  -d '{"lang":"zh-CN","token":"你的TOKEN","items":[{"k":"Hello.","v":"你好。","model":"test"}]}'

# 拉取
curl "https://eco-npc-dict.<你的子域>.workers.dev/pull?lang=zh-CN&token=你的TOKEN"
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/pull?lang=zh-CN&since=<ts>&token=` | 拉取 ts 之后的词条；返回 `{entries, cursor, more}`，下次用返回的 `cursor` 当 `since` 做增量 |
| POST | `/contribute` | body `{lang, token, items:[{k,v,model}]}`，先到先得（已存在不覆盖） |
| GET | `/stats?lang=zh-CN` | 词条总数、最后入库时间 |

数据模型：`(lang, k)` 唯一，`INSERT OR IGNORE` 先到先得；保留 `model`/`ts` 字段，方便以后做“好模型覆盖”。
