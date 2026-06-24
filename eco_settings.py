# -*- coding: utf-8 -*-
"""
ECO NPC 翻译 - 图形配置工具
  下拉选服务商 -> 自动填地址/常用模型 -> 填 API Key -> (可选)测试 -> 保存
  配置写入同目录 translate_config.json, 主程序启动时读取。
"""
import os, sys, json, threading
import tkinter as tk
from tkinter import ttk, messagebox

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, "translate_config.json")
sys.path.insert(0, HERE)                              # 优先用随程序打包的 screen_translator
sys.path.append(r"C:\Users\31459\Documents\自动翻译")  # 后备: 开发机原路径

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
        root.geometry("560x420")
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

        self.lbl_hint = ttk.Label(frm, text="", foreground="#666", wraplength=420, justify="left")
        self.lbl_hint.grid(row=4, column=0, columnspan=3, sticky="w", padx=12)

        btns = ttk.Frame(frm); btns.grid(row=5, column=0, columnspan=3, pady=18)
        ttk.Button(btns, text="测试连接", command=self.test).pack(side="left", padx=8)
        ttk.Button(btns, text="保存", command=self.save).pack(side="left", padx=8)
        ttk.Button(btns, text="关闭", command=root.destroy).pack(side="left", padx=8)

        self.lbl_status = ttk.Label(frm, text="", wraplength=500, justify="left")
        self.lbl_status.grid(row=6, column=0, columnspan=3, sticky="w", padx=12, pady=4)

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
        return dict(provider=p["provider"], model=self.cb_model.get().strip(),
                    base_url=self.e_base.get().strip(), api_key=self.e_key.get().strip())

    def save(self):
        cfg = self._collect()
        p = PRESETS[self.cb_provider.get()]
        if p["need_key"] and not cfg["api_key"]:
            messagebox.showwarning("缺少 API Key", "该服务商需要填写 API Key。"); return
        if not cfg["model"]:
            messagebox.showwarning("缺少模型", "请填写或选择一个模型。"); return
        try:
            json.dump(cfg, open(CONFIG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            self.lbl_status.config(text="已保存到 translate_config.json，重新启动翻译即可生效。", foreground="green")
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
                tr = create_translator(TranslationConfig(**cfg))
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
