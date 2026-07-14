# -*- coding: utf-8 -*-
"""
ECO NPC 翻译 - 图形配置工具
  下拉选服务商 -> 自动填地址/常用模型 -> 填 API Key -> (可选)测试 -> 保存
  配置写入同目录 translate_config.json, 主程序启动时读取。
"""
import os, sys, json, re, threading
import tkinter as tk
from tkinter import ttk, messagebox

if getattr(sys, "frozen", False):
    RES_DIR = sys._MEIPASS
    DATA_DIR = os.path.dirname(sys.executable)
else:
    RES_DIR = DATA_DIR = os.path.dirname(os.path.abspath(__file__))
HERE = DATA_DIR
CONFIG_FILE = os.path.join(DATA_DIR, "translate_config.json")   # 写到 exe 同目录(可写)
SYNC_FILE = os.path.join(DATA_DIR, "sync_config.json")          # 共享词库配置
sys.path.insert(0, RES_DIR)                           # 优先用随程序打包的 screen_translator
sys.path.append(r"C:\Users\31459\Documents\自动翻译")  # 后备: 开发机原路径

def load_sync():
    try: return json.load(open(SYNC_FILE, encoding="utf-8"))
    except Exception: return {}

# 服务商预设: 名称 -> provider/默认地址/常用模型/是否需要key/说明
PRESETS = {
    "DeepSeek (推荐, 快)": dict(provider="deepseek", base_url="https://api.deepseek.com",
        models=["deepseek-v4-flash", "deepseek-chat"], need_key=True,
        hint="官网 platform.deepseek.com 申请 key, 形如 sk-..."),
    "OpenAI": dict(provider="openai", base_url="",
        models=["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"], need_key=True,
        hint="platform.openai.com 申请 key, 形如 sk-..."),
    "OpenRouter (一个key用多模型)": dict(provider="openrouter", base_url="https://openrouter.ai/api/v1",
        models=["google/gemini-flash-1.5", "openai/gpt-4o-mini", "deepseek/deepseek-chat"], need_key=True,
        hint="openrouter.ai 申请 key, 形如 sk-or-..."),
    "Gemini (需 pip install google-genai)": dict(provider="gemini", base_url="",
        models=["gemini-2.0-flash", "gemini-1.5-flash"], need_key=True,
        hint="aistudio.google.com 申请 key, 形如 AIza..."),
    "本地 Ollama (免费/离线/无需key)": dict(provider="ollama", base_url="http://127.0.0.1:11434",
        models=["gemma4:12b", "qwen2.5:7b", "llama3.1:8b"], need_key=False,
        hint="需先 ollama serve 并 ollama pull 对应模型"),
    "DeepL": dict(provider="deepl", base_url="https://api-free.deepl.com/v2",
        models=[""], need_key=True, hint="DeepL API key"),
}

def load_existing():
    try:
        return json.load(open(CONFIG_FILE, encoding="utf-8"))
    except Exception:
        return {}

class App:
    def __init__(self, root):
        self.root = root
        root.title("ECO NPC 翻译 - 配置")
        root.geometry("620x700")
        root.resizable(False, False)
        pad = dict(padx=12, pady=6)

        cur = load_existing()

        frm = ttk.Frame(root, padding=16); frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="翻译服务商", font=("", 10, "bold")).grid(row=0, column=0, sticky="w", **pad)
        self.cb_provider = ttk.Combobox(frm, values=list(PRESETS.keys()), state="readonly", width=38)
        self.cb_provider.grid(row=0, column=1, sticky="w", **pad)
        self.cb_provider.bind("<<ComboboxSelected>>", self.on_provider)

        ttk.Label(frm, text="模型").grid(row=1, column=0, sticky="w", **pad)
        self.cb_model = ttk.Combobox(frm, width=38)   # 可编辑, 也可手填
        self.cb_model.grid(row=1, column=1, sticky="w", **pad)

        ttk.Label(frm, text="接口地址 (base_url)").grid(row=2, column=0, sticky="w", **pad)
        self.e_base = ttk.Entry(frm, width=41); self.e_base.grid(row=2, column=1, sticky="w", **pad)

        ttk.Label(frm, text="API Key").grid(row=3, column=0, sticky="w", **pad)
        self.e_key = ttk.Entry(frm, width=41, show="*"); self.e_key.grid(row=3, column=1, sticky="w", **pad)
        self.show_var = tk.IntVar(value=0)
        ttk.Checkbutton(frm, text="显示", variable=self.show_var, command=self.toggle_key)\
            .grid(row=3, column=2, sticky="w")

        ttk.Label(frm, text="目标语言").grid(row=4, column=0, sticky="w", **pad)
        self.cb_lang = ttk.Combobox(frm, values=["简体中文 (zh-CN)", "繁体中文 (zh-TW)"],
                                    state="readonly", width=18)
        self.cb_lang.grid(row=4, column=1, sticky="w", **pad)

        note = dict(foreground="#666", wraplength=560, justify="left")

        ttk.Label(frm, text="首屏等待(秒)").grid(row=5, column=0, sticky="w", **pad)
        self.cb_wait = ttk.Combobox(frm, values=["0", "1.0", "1.5", "2.0", "2.5", "3.0"], width=8)
        self.cb_wait.grid(row=5, column=1, sticky="w", **pad)
        ttk.Label(frm, text="0 = 不等(第一次英文最流畅); 越大越能让第一次就显中文, 但会略停顿",
                  **note).grid(row=6, column=0, columnspan=3, sticky="w", padx=12)

        ttk.Label(frm, text="角色名").grid(row=7, column=0, sticky="w", **pad)
        self.e_names = ttk.Entry(frm, width=41); self.e_names.grid(row=7, column=1, sticky="w", **pad)
        ttk.Label(frm, text="多个用逗号隔开; 让对话里你的角色名被正确识别(模板化, 跨玩家通用)",
                  **note).grid(row=8, column=0, columnspan=3, sticky="w", padx=12)

        ttk.Label(frm, text="切换热键").grid(row=9, column=0, sticky="w", **pad)
        self.e_hotkey = ttk.Entry(frm, width=12); self.e_hotkey.grid(row=9, column=1, sticky="w", **pad)
        ttk.Label(frm, text="中 / 英 切换键, 默认 f9; 留空 = 关闭切换",
                  **note).grid(row=10, column=0, columnspan=3, sticky="w", padx=12)

        ttk.Separator(frm, orient="horizontal").grid(row=11, column=0, columnspan=3, sticky="ew", pady=8)
        self.sync_var = tk.IntVar(value=0)
        ttk.Checkbutton(frm, text="启用共享词库 (众包: 自动上报/拉取译文)", variable=self.sync_var)\
            .grid(row=12, column=0, columnspan=3, sticky="w", padx=12)
        ttk.Label(frm, text="节点地址").grid(row=13, column=0, sticky="w", **pad)
        self.e_url = ttk.Entry(frm, width=41); self.e_url.grid(row=13, column=1, columnspan=2, sticky="w", **pad)
        ttk.Label(frm, text="口令 token").grid(row=14, column=0, sticky="w", **pad)
        self.e_token = ttk.Entry(frm, width=41); self.e_token.grid(row=14, column=1, columnspan=2, sticky="w", **pad)

        self.lbl_hint = ttk.Label(frm, text="", **note)
        self.lbl_hint.grid(row=15, column=0, columnspan=3, sticky="w", padx=12)

        btns = ttk.Frame(frm); btns.grid(row=16, column=0, columnspan=3, pady=14)
        ttk.Button(btns, text="测试连接", command=self.test).pack(side="left", padx=8)
        ttk.Button(btns, text="保存", command=self.save).pack(side="left", padx=8)
        ttk.Button(btns, text="关闭", command=root.destroy).pack(side="left", padx=8)

        self.lbl_status = ttk.Label(frm, text="", wraplength=560, justify="left")
        self.lbl_status.grid(row=17, column=0, columnspan=3, sticky="w", padx=12, pady=4)

        # 回填已有配置 / 默认选第一个
        self._init_from(cur)

    def _init_from(self, cur):
        prov = cur.get("provider", "deepseek")
        # 找到匹配的预设名
        name = next((k for k, v in PRESETS.items() if v["provider"] == prov), list(PRESETS.keys())[0])
        self.cb_provider.set(name)
        self.on_provider()
        if cur.get("model"): self.cb_model.set(cur["model"])
        if cur.get("base_url"): self.e_base.delete(0, "end"); self.e_base.insert(0, cur["base_url"])
        if cur.get("api_key"):
            self.e_key.delete(0, "end"); self.e_key.insert(0, cur["api_key"])
        self.cb_wait.set(str(cur.get("first_wait", 0)))
        self.cb_lang.set("繁体中文 (zh-TW)" if cur.get("target_lang") == "zh-TW" else "简体中文 (zh-CN)")
        names = cur.get("player_names", [])
        if isinstance(names, str): names = [names]
        self.e_names.insert(0, ", ".join(names))
        self.e_hotkey.insert(0, cur.get("toggle_hotkey", "f9"))
        sc = load_sync()
        self.sync_var.set(1 if sc.get("enabled") else 0)
        if sc.get("url"): self.e_url.insert(0, sc["url"])
        if sc.get("token"): self.e_token.insert(0, sc["token"])

    def on_provider(self, *_):
        p = PRESETS[self.cb_provider.get()]
        self.cb_model["values"] = p["models"]
        self.cb_model.set(p["models"][0])
        self.e_base.delete(0, "end"); self.e_base.insert(0, p["base_url"])
        tip = p["hint"]
        if not p["need_key"]:
            tip += "  (本服务无需 API Key)"
        self.lbl_hint.config(text="说明: " + tip)

    def toggle_key(self):
        self.e_key.config(show="" if self.show_var.get() else "*")

    def _collect(self):
        p = PRESETS[self.cb_provider.get()]
        try: fw = float(self.cb_wait.get().strip())
        except Exception: fw = 1.5
        lang = "zh-TW" if "zh-TW" in self.cb_lang.get() else "zh-CN"
        names = [n.strip() for n in re.split(r"[,，]", self.e_names.get()) if n.strip()]
        return dict(provider=p["provider"], model=self.cb_model.get().strip(),
                    base_url=self.e_base.get().strip(), api_key=self.e_key.get().strip(),
                    first_wait=fw, target_lang=lang, player_names=names,
                    toggle_hotkey=self.e_hotkey.get().strip())

    def save(self):
        cfg = self._collect()
        p = PRESETS[self.cb_provider.get()]
        if p["need_key"] and not cfg["api_key"]:
            messagebox.showwarning("缺少 API Key", "该服务商需要填写 API Key。"); return
        if not cfg["model"]:
            messagebox.showwarning("缺少模型", "请填写或选择一个模型。"); return
        try:
            json.dump(cfg, open(CONFIG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            # 共享词库 -> sync_config.json(保留已有的拉取间隔等)
            sc = load_sync()
            sc["enabled"] = bool(self.sync_var.get())
            sc["url"] = self.e_url.get().strip()
            sc["token"] = self.e_token.get().strip()
            sc.setdefault("pull_interval", 300); sc.setdefault("flush_interval", 20)
            sc.setdefault("pull_on_start", True)
            json.dump(sc, open(SYNC_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            self.lbl_status.config(text="已保存。重启翻译(启动NPC翻译.cmd)即可生效。", foreground="green")
        except Exception as e:
            messagebox.showerror("保存失败", str(e))

    def test(self):
        cfg = self._collect()
        self.lbl_status.config(text="测试中...", foreground="#333")
        self.root.update()
        def run():
            try:
                from screen_translator.translator import create_translator
                from screen_translator.config import TranslationConfig
                tc = {k: cfg[k] for k in ("provider", "model", "base_url", "api_key")}
                tr = create_translator(TranslationConfig(**tc))
                out = tr.translate("Hello, adventurer!", "en", "zh-CN")
                self.root.after(0, lambda: self.lbl_status.config(
                    text=f"测试成功 ✓  译文: {out}", foreground="green"))
            except Exception as e:
                msg = str(e)
                self.root.after(0, lambda: self.lbl_status.config(
                    text=f"测试失败 ✗  {msg}", foreground="red"))
        threading.Thread(target=run, daemon=True).start()

if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
