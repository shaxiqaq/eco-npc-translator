# -*- coding: utf-8 -*-
"""
共享词库同步: 自动上报本地新翻译 + 自动拉取别人贡献。
配置文件 sync_config.json(不存在/enabled=false 则完全不联网)。
只用标准库 urllib, 不加依赖。所有网络错误都吞掉(离线照常本地工作)。
"""
import os, json, time, threading, urllib.request, urllib.error

def load_cfg(data_dir):
    try:
        c = json.load(open(os.path.join(data_dir, "sync_config.json"), encoding="utf-8"))
    except Exception:
        return None
    if not c.get("enabled") or not c.get("url"):
        return None
    c["url"] = c["url"].rstrip("/")
    c.setdefault("token", "")
    c.setdefault("pull_interval", 300)
    c.setdefault("flush_interval", 20)
    c.setdefault("pull_on_start", True)
    return c

_UA = "eco-npc-dict/1.0"   # 普通 UA: 避免被 Cloudflare 拦默认的 Python-urllib

def _post(url, obj, timeout=15):
    data = json.dumps(obj).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

class Sync:
    """data_dir: 数据目录; lang: 目标语言; model: 本机所用模型(上报标注);
       merge_fn(dict)->int: 把拉到的 {k:v} 合并进本地缓存并落盘, 返回新增条数。"""
    def __init__(self, data_dir, lang, model, merge_fn):
        self.data_dir = data_dir
        self.lang = lang or "zh-CN"
        self.model = model or "?"
        self.merge_fn = merge_fn
        self.cfg = load_cfg(data_dir)
        self.cursor_file = os.path.join(data_dir, "sync_cursor.json")
        self.q = []                       # 待上报 [(k, v), ...]
        self.qlock = threading.Lock()
        self.seen_up = set()              # 本进程已上报过的 key, 避免重复
        self._stop = False

    @property
    def enabled(self):
        return self.cfg is not None

    def _read_cursor(self):
        try: return json.load(open(self.cursor_file, encoding="utf-8")).get(self.lang, 0)
        except Exception: return 0

    def _write_cursor(self, ts):
        d = {}
        try: d = json.load(open(self.cursor_file, encoding="utf-8"))
        except Exception: pass
        d[self.lang] = ts
        try: json.dump(d, open(self.cursor_file, "w", encoding="utf-8"))
        except Exception: pass

    def enqueue(self, k, v):
        if not self.enabled or not k or not v:
            return
        with self.qlock:
            if k in self.seen_up:
                return
            self.seen_up.add(k)
            self.q.append((k, v))

    def push_all(self, cache_dict):
        """把整个本地缓存排队上报(含命中缓存/仓库直给/没走API 的条目)。
           节点 INSERT OR IGNORE 幂等, 重复条目服务器直接忽略。"""
        if not self.enabled:
            return
        n = 0
        for k, v in list(cache_dict.items()):
            self.enqueue(k, v); n += 1
        if n:
            print(f"[同步] 已排队全量上报 {n} 条本地缓存(去重后增量入库)", flush=True)

    def start(self):
        if not self.enabled:
            print("[同步] 未配置 sync_config.json, 仅本地缓存(不联网)。", flush=True)
            return
        print(f"[同步] 共享词库已启用: {self.cfg['url']}  语言={self.lang}", flush=True)
        if self.cfg.get("pull_on_start", True):
            threading.Thread(target=self._pull_once, daemon=True).start()
        threading.Thread(target=self._pull_loop, daemon=True).start()
        threading.Thread(target=self._flush_loop, daemon=True).start()

    # ---- 拉取 ----
    def _pull_loop(self):
        iv = max(30, int(self.cfg.get("pull_interval", 300)))
        while not self._stop:
            time.sleep(iv)
            self._pull_once()

    def _pull_once(self):
        cur = self._read_cursor()
        total_new = 0
        try:
            for _ in range(20):           # 最多翻 20 页, 防止意外死循环
                u = (f"{self.cfg['url']}/pull?lang={self.lang}"
                     f"&since={cur}&token={urllib.parse.quote(self.cfg['token'])}")
                res = _get(u)
                ents = res.get("entries") or {}
                if ents:
                    total_new += self.merge_fn(ents)
                cur = res.get("cursor", cur)
                self._write_cursor(cur)
                if not res.get("more"):
                    break
            if total_new:
                print(f"[同步] 拉取合并 {total_new} 条新译文", flush=True)
        except Exception as e:
            print(f"[同步] 拉取失败(忽略): {e}", flush=True)

    # ---- 上报 ----
    def _flush_loop(self):
        iv = max(5, int(self.cfg.get("flush_interval", 20)))
        while not self._stop:
            time.sleep(iv)
            self._flush_once()

    def _flush_once(self):
        with self.qlock:
            batch = self.q[:400]
        if not batch:
            return
        items = [{"k": k, "v": v, "model": self.model} for k, v in batch]
        try:
            res = _post(f"{self.cfg['url']}/contribute",
                        {"lang": self.lang, "token": self.cfg["token"], "items": items})
            with self.qlock:
                del self.q[:len(batch)]
            ins = res.get("inserted", 0)
            if ins:
                print(f"[同步] 上报 {len(batch)} 条, 服务器新增 {ins}", flush=True)
        except Exception as e:
            print(f"[同步] 上报失败(下次重试,忽略): {e}", flush=True)

import urllib.parse  # 放末尾避免顶部顺序困扰
