# -*- coding: utf-8 -*-
"""
共享词库同步: 自动上报本地新翻译 + 自动拉取别人贡献。
配置文件 sync_config.json(不存在/enabled=false 则完全不联网)。
只用标准库 urllib, 不加依赖。所有网络错误都吞掉(离线照常本地工作)。
"""
import os
import sys
import json
import time
import threading
import urllib.request
import urllib.error
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eco_log import setup_logger

logger = setup_logger(
    "eco.cache_sync",
    log_dir=os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs"),
    log_file="cache_sync.log",
    stream=sys.stdout,
)


# Public shared dictionary for all toolbox users (Cloudflare Worker + D1).
# Users can turn off in Settings → 翻译服务 → 共享词库.
DEFAULT_SYNC_CONFIG = {
    "enabled": True,
    "url": "https://eco-npc-dict.w3145965836.workers.dev",
    "token": "eco_NWODgbGAcW7Zd5EXsuf6P-Kq",
    "pull_interval": 300,
    "flush_interval": 20,
    "pull_on_start": True,
}


def _write_cfg(data_dir, cfg):
    path = os.path.join(data_dir, "sync_config.json")
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8") as stream:
            json.dump(cfg, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except Exception:
        pass


def load_cfg(data_dir):
    """Load sync config; default to public shared node when missing/unconfigured."""
    path = os.path.join(data_dir, "sync_config.json")
    c = None
    try:
        with open(path, encoding="utf-8") as stream:
            c = json.load(stream)
    except Exception:
        c = None

    if not isinstance(c, dict):
        c = dict(DEFAULT_SYNC_CONFIG)
        _write_cfg(data_dir, c)
    else:
        url = str(c.get("url") or "").strip()
        # Old installs had enabled:false + empty url — upgrade to public node.
        if not url:
            c = dict(DEFAULT_SYNC_CONFIG)
            _write_cfg(data_dir, c)

    if c.get("enabled") is False:
        return None
    url = str(c.get("url") or "").strip()
    if not url:
        return None
    c["url"] = url.rstrip("/")
    c.setdefault("token", DEFAULT_SYNC_CONFIG["token"])
    if not c.get("token"):
        c["token"] = DEFAULT_SYNC_CONFIG["token"]
    c.setdefault("pull_interval", 300)
    c.setdefault("flush_interval", 20)
    c.setdefault("pull_on_start", True)
    return c


_UA = "eco-npc-dict/1.0"   # 普通 UA: 避免被 Cloudflare 拦默认的 Python-urllib


def _post(url, obj, timeout=15):
    data = json.dumps(obj).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": _UA},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class Sync:
    def __init__(self, data_dir, lang, model, merge_fn):
        self.data_dir = data_dir
        self.lang = lang
        self.model = model
        self.merge_fn = merge_fn
        self.cfg = load_cfg(data_dir)
        self.enabled = bool(self.cfg)
        self.cursor_file = os.path.join(data_dir, "sync_cursor.json")
        self.q = []
        self.seen_up = set()
        self.qlock = threading.Lock()
        self._stop = False
        self._reject_counts = {
            "untrusted_model": 0,
            "dirty_text": 0,
            "ambiguous_short": 0,
            "source_zh": 0,
            "other": 0,
        }
        self._reject_log_left = 8  # 启动后少量样例日志，避免刷屏

    def _read_cursor(self, bucket=None):
        key = bucket or self.lang
        try:
            return json.load(open(self.cursor_file, encoding="utf-8")).get(key, 0)
        except Exception:
            return 0

    def _write_cursor(self, ts, bucket=None):
        key = bucket or self.lang
        d = {}
        try:
            d = json.load(open(self.cursor_file, encoding="utf-8"))
        except Exception:
            pass
        d[key] = ts
        try:
            json.dump(d, open(self.cursor_file, "w", encoding="utf-8"))
        except Exception:
            pass

    def _merge(self, ents, source_lang):
        if not ents:
            return 0
        try:
            return self.merge_fn(ents, source_lang)
        except TypeError:
            return self.merge_fn(ents)

    def enqueue(self, k, v, source_lang="en"):
        """排队上报共享词库。本地缓存由调用方写入；此处只做共享质量门禁。"""
        if not self.enabled or not k or not v:
            return
        try:
            from eco_source_lang import parse_storage_key, resolve_source_lang, sync_bucket
        except Exception:
            parse_storage_key = None
            resolve_source_lang = None
            sync_bucket = None
        raw_key, src = k, source_lang
        if parse_storage_key is not None and (
            k.startswith("ja::") or k.startswith("id::") or k.startswith("zh::")
        ):
            src, raw_key = parse_storage_key(k)
        try:
            from eco_translation_quality import normalize_text

            raw_key = normalize_text(raw_key)
            v = normalize_text(v)
        except Exception:
            pass
        if not raw_key or not v:
            return
        # Force {PC} templating so unconfigured clients don't upload raw character names.
        try:
            from eco_pc_template import load_player_names_from_data_dir, normalize_shared_pair

            names = load_player_names_from_data_dir(self.data_dir)
            nk, nv = normalize_shared_pair(raw_key, v, names)
            if nk and nv:
                raw_key, v = nk, nv
        except Exception:
            pass
        if not raw_key or not v:
            return
        if resolve_source_lang is not None:
            src = resolve_source_lang(raw_key, src or "auto")
        bucket = sync_bucket(self.lang, src) if sync_bucket else self.lang
        try:
            from eco_translation_quality import should_upload, reject_reason
        except Exception:
            # 质检模块不可用时仍上报（避免阻断旧包）
            should_upload = None
            reject_reason = None
        if should_upload is not None and not should_upload(
            raw_key, v, self.model, self.lang, source_lang=src
        ):
            reason = "other"
            if reject_reason is not None:
                reason = (
                    reject_reason(raw_key, v, self.model, self.lang, source_lang=src)
                    or "other"
                )
            self._reject_counts[reason] = self._reject_counts.get(reason, 0) + 1
            if self._reject_log_left > 0:
                self._reject_log_left -= 1
                preview = (str(raw_key)[:40] + "…") if len(str(raw_key)) > 40 else str(raw_key)
                logger.info(
                    "[同步] 跳过上报(%s) model=%s src=%s key=%r",
                    reason,
                    self.model,
                    src,
                    preview,
                )
            return
        seen = (bucket, raw_key)
        with self.qlock:
            if seen in self.seen_up:
                return
            self.seen_up.add(seen)
            self.q.append((bucket, raw_key, v))

    def push_all(self, cache_dict):
        """把整个本地缓存排队上报(含命中缓存/仓库直给/没走API 的条目)。
           仅通过质检且当前模型在可信名单内的条目会入队。
           节点 INSERT OR IGNORE 幂等, 重复条目服务器直接忽略。"""
        if not self.enabled:
            return
        n = 0
        before_q = 0
        with self.qlock:
            before_q = len(self.q)
        for k, v in list(cache_dict.items()):
            self.enqueue(k, v)
            n += 1
        with self.qlock:
            queued = len(self.q) - before_q
        skipped = n - queued
        if n:
            logger.info(
                "[同步] 全量扫描 %s 条本地缓存, 入队 %s, 质检跳过 %s (model=%s)",
                n,
                queued,
                skipped,
                self.model,
            )
            if any(self._reject_counts.values()):
                logger.info(
                    "[同步] 跳过原因: 不可信模型=%s 脏文本=%s 短歧义=%s 中文源=%s 其他=%s",
                    self._reject_counts.get("untrusted_model", 0),
                    self._reject_counts.get("dirty_text", 0),
                    self._reject_counts.get("ambiguous_short", 0),
                    self._reject_counts.get("source_zh", 0),
                    self._reject_counts.get("other", 0),
                )

    def start(self):
        if not self.enabled:
            logger.info("[同步] 未配置 sync_config.json, 仅本地缓存(不联网)。")
            return
        logger.info(
            "[同步] 共享词库已启用: %s  目标=%s 桶=%s/%s-ja/%s-id",
            self.cfg["url"],
            self.lang,
            self.lang,
            self.lang,
            self.lang,
        )
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
        try:
            from eco_source_lang import SYNC_SOURCE_BUCKETS, source_from_bucket, sync_bucket
        except Exception:
            SYNC_SOURCE_BUCKETS = ("en",)
            source_from_bucket = lambda bucket, target: "en"
            sync_bucket = lambda target, src: target
        total_new = 0
        try:
            for src in SYNC_SOURCE_BUCKETS:
                bucket = sync_bucket(self.lang, src)
                total_new += self._pull_bucket(bucket, source_from_bucket(bucket, self.lang))
            if total_new:
                logger.info("[同步] 拉取合并 %s 条新译文", total_new)
        except Exception as e:
            logger.warning("[同步] 拉取失败(忽略): %s", e)

    def _pull_bucket(self, bucket, source_lang):
        cur = self._read_cursor(bucket)
        added = 0
        for _ in range(20):
            u = (
                f"{self.cfg['url']}/pull?lang={urllib.parse.quote(bucket)}"
                f"&since={cur}&token={urllib.parse.quote(self.cfg['token'])}"
            )
            res = _get(u)
            ents = res.get("entries") or {}
            if ents:
                added += self._merge(ents, source_lang) or 0
            cur = res.get("cursor", cur)
            self._write_cursor(cur, bucket)
            if not res.get("more"):
                break
        return added

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
        # New items are (bucket, k, v). Old in-memory tuples (k, v) stay on self.lang.
        grouped = {}
        for item in batch:
            if len(item) == 3:
                bucket, k, v = item
            else:
                bucket, k, v = self.lang, item[0], item[1]
            grouped.setdefault(bucket, []).append((k, v))
        try:
            inserted = 0
            received = 0
            for bucket, pairs in grouped.items():
                items = [{"k": k, "v": v, "model": self.model} for k, v in pairs]
                res = _post(
                    f"{self.cfg['url']}/contribute",
                    {"lang": bucket, "token": self.cfg["token"], "items": items},
                )
                received += len(pairs)
                inserted += int(res.get("inserted", 0) or 0)
            with self.qlock:
                del self.q[: len(batch)]
            if inserted:
                logger.info("[同步] 上报 %s 条, 服务器新增 %s", received, inserted)
        except Exception as e:
            logger.warning("[同步] 上报失败(下次重试,忽略): %s", e)
