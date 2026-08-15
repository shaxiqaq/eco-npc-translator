# -*- coding: utf-8 -*-
"""
ECO 只读采集器(地基版): 你正常跟 NPC 对话, 它把每句英文连同 eventid + NPC名 记录下来。
不改包、不注入、零风险。验证「对话 ↔ eventid」能否打通。

产出:
  harvest.jsonl    —— 每条记录一行 {eventid, event_source, actor, npc, kind, en, options, ts}
  harvest_dict.json—— 按 eventid 聚合 {eventid: {npc, says:[...], selects:[...]}}
用法: python eco_harvester.py   (eco.exe 在线; 进城找 NPC 对话/翻菜单)
"""
import atexit
import os, sys, json, time, re, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import frida
from eco_log import setup_logger
from eco_paths import resolve_dirs, ensure_data_layout, log_dir, resource_path

_RES_DIR, HERE = resolve_dirs(__file__)
ensure_data_layout(HERE)
MAP_PORT = 12002
JL = os.path.join(HERE, "harvest.jsonl")
DICT = os.path.join(HERE, "harvest_dict.json")
logger = setup_logger(
    "eco.harvester",
    log_dir=log_dir(HERE),
    log_file="eco_harvester.log",
)

_CLEAN_RE = re.compile(r"\$[A-Za-z]")
_WS_RE = re.compile(r"[ \t]+")
_NL_WS_RE = re.compile(r"\n[ \t]+")
_NL2_RE = re.compile(r"\n{2,}")

def _clean(t):
    t = t.replace("$R", "\n").replace("$P", "\n")
    t = _CLEAN_RE.sub("", t)
    t = t.replace(";", "\n")
    t = _WS_RE.sub(" ", t)
    t = _NL_WS_RE.sub("\n", t)
    return _NL2_RE.sub("\n", t).strip()

def parse_1512(sub):
    """[op2][actor4][eventid4]"""
    if len(sub) < 10: return None, None
    actor = int.from_bytes(sub[2:6], "big")
    eventid = int.from_bytes(sub[6:10], "big")
    return actor, eventid

def parse_1510(sub):
    """客户端合法点击请求: [op2][eventid4][x1][y1]。"""
    if len(sub) < 8: return None, None, None
    return int.from_bytes(sub[2:6], "big"), sub[6], sub[7]

def parse_1017(sub):
    """[op2][npc4][flag2][segN1]{[len1][seg]}*N [motion2][nameLen1][name..]"""
    try:
        actor = int.from_bytes(sub[2:6], "big")
        p = 8; segN = sub[p]; p += 1; segs = []
        for _ in range(segN):
            l = sub[p]; p += 1; segs.append(sub[p:p+l]); p += l
        tail = sub[p:]
        name = ""
        if len(tail) >= 3:
            nl = tail[2]; name = tail[3:3+nl].decode("utf-8", "replace").split("\0")[0].strip()
        en = _clean("".join(s.decode("utf-8", "replace") for s in segs))
        return actor, name, en
    except Exception:
        return None, "", ""

def parse_1526(sub):
    """[op2][qlen1][question(含null)][optCount1][indices(optCount+1)]{[len1][opt]}*N"""
    try:
        p = 2; qlen = sub[p]; p += 1
        question = sub[p:p+qlen].split(b"\0")[0].decode("utf-8", "replace").strip(); p += qlen
        optCount = sub[p]; p += 1
        p += optCount + 1                      # 跳过 indices
        opts = []
        for _ in range(optCount):
            l = sub[p]; p += 1
            opts.append(sub[p:p+l].decode("utf-8", "replace").strip()); p += l
        return question, opts
    except Exception:
        return "", []

class Harvester:
    def __init__(self):
        self.last_event_by_actor = {}      # actor -> eventid (来自 op1512)
        self.cur_event = None              # 本次交互 op1512 的 eventid(可能没有)
        self.cur_event_source = None
        self.pending_event = None          # 客户端 op1510 合法点击请求
        self.cur_npc_id = None             # 本次交互 op1511 的 NPC id(兜底用)
        self.seen = set()                  # 去重 (eventid, kind, text)
        self.agg = {}                      # eventid -> {npc, says[], selects[]}
        self.lock = threading.Lock()
        self.n_say = self.n_sel = 0
        self.dirty = False
        self._last_flush = 0.0
        if os.path.exists(DICT):
            try: self.agg = json.load(open(DICT, encoding="utf-8"))
            except Exception: pass
        # 从已有产物重建去重集: 重启后也不会把同一句重复追加进 harvest_dict.json
        for k, e in self.agg.items():
            for s in e.get("says", []): self.seen.add((str(k), "say", s))
            for sel in e.get("selects", []):
                self.seen.add((str(k), "sel", sel.get("q", "") + "|" + "|".join(sel.get("options", []))))
        atexit.register(self.flush)

    def _write_jl(self, rec):
        with open(JL, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def _save_dict(self, force=False):
        """Batch disk writes: flush at most every ~2s unless forced."""
        now = time.time()
        if not force and self.dirty and (now - self._last_flush) < 2.0:
            return
        if not self.dirty and not force:
            return
        try:
            json.dump(self.agg, open(DICT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            self.dirty = False
            self._last_flush = now
        except Exception as e:
            logger.warning("保存 harvest_dict 失败: %s", e)

    def flush(self):
        with self.lock:
            if self.dirty:
                self._save_dict(force=True)

    def _agg_entry(self, eid):
        k = str(eid)
        if k not in self.agg: self.agg[k] = {"npc": "", "says": [], "selects": []}
        return self.agg[k]

    def on_msg(self, message, data):
        if message.get("type") != "send":
            if message.get("type") == "error":
                logger.error("[JS ERR] %s", message.get("stack"))
            return
        p = message["payload"]
        if p == "READY":
            logger.info("[*] 采集就位。进城找 NPC 对话/翻菜单, 会实时打印 eventid。Ctrl+C 结束。")
            return
        op = p.get("op"); sub = bytes.fromhex(p["sub"])
        with self.lock:
            if op == 1510:
                eid, _x, _y = parse_1510(sub)
                self.pending_event = eid
                return
            if op == 1500:                       # 事件开始: 重置本次交互上下文
                self.cur_event = self.pending_event
                self.cur_event_source = "client_request" if self.pending_event is not None else None
                self.pending_event = None; self.cur_npc_id = None; return
            if op == 1501:                       # 事件结束
                self.cur_event = None; self.cur_event_source = None; self.cur_npc_id = None
                return
            if op == 1511:                       # CHANGE_VIEW: 头4字节 = 当前NPC id
                if len(sub) >= 6: self.cur_npc_id = int.from_bytes(sub[2:6], "big")
                return
            if op == 1512:                       # 执行中的 eventid(仅部分事件发)
                actor, eid = parse_1512(sub)
                if actor is not None:
                    self.last_event_by_actor[actor] = eid; self.cur_event = eid
                    self.cur_event_source = "server_1512"
                return
            if op == 1017:
                actor, name, en = parse_1017(sub)
                if not en: return
                # eventid 多源兜底: 执行中eventid > 该actor的eventid > NPC自身id
                if self.cur_event is not None:
                    eid, event_source = self.cur_event, self.cur_event_source
                elif actor in self.last_event_by_actor:
                    eid, event_source = self.last_event_by_actor[actor], "server_1512_actor_cache"
                else:
                    eid, event_source = actor, "actor_fallback"
                key = (str(eid), "say", en)
                if key in self.seen: return
                self.seen.add(key)
                rec = {"eventid": eid, "event_source": event_source,
                       "actor": actor, "npc": name, "kind": "say",
                       "en": en, "ts": int(time.time())}
                self._write_jl(rec)
                e = self._agg_entry(eid)
                if name and not e["npc"]: e["npc"] = name
                e["says"].append(en)
                self.dirty = True
                self._save_dict()
                self.n_say += 1
                logger.info("[say] eid=%s npc=%r | %r", eid, name, en[:50])
            elif op == 1526:
                q, opts = parse_1526(sub)
                if not q and not opts: return
                if self.cur_event is not None:
                    eid, event_source = self.cur_event, self.cur_event_source
                else:
                    eid, event_source = self.cur_npc_id, "npc_view_fallback"
                key = (str(eid), "sel", q + "|" + "|".join(opts))
                if key in self.seen: return
                self.seen.add(key)
                rec = {"eventid": eid, "event_source": event_source,
                       "kind": "select", "en": q, "options": opts,
                       "ts": int(time.time())}
                self._write_jl(rec)
                e = self._agg_entry(eid)
                e["selects"].append({"q": q, "options": opts})
                self.dirty = True
                self._save_dict()
                self.n_sel += 1
                logger.info("[sel] eid=%s | %r 选项%s", eid, q[:40], opts)

def main():
    dev = frida.get_local_device()
    ecos = [p for p in dev.enumerate_processes() if p.name.lower() == "eco.exe"]
    if not ecos:
        logger.error("没有运行中的 eco.exe")
        return
    pid = max(ecos, key=lambda x: x.pid).pid
    logger.info("[*] attach %s", pid)
    js = open(resource_path(_RES_DIR, "_harvest.js"), encoding="utf-8").read().replace("__MAP_PORT__", str(MAP_PORT))
    h = Harvester()
    s = dev.attach(pid); script = s.create_script(js); script.on("message", h.on_msg); script.load()
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        h.flush()
        logger.info("[*] 结束。共采 say %s, select %s。-> %s", h.n_say, h.n_sel, DICT)

if __name__ == "__main__":
    main()
