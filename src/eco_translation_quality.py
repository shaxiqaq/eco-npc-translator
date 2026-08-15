# -*- coding: utf-8 -*-
"""
共享词库上传质检 + 可信模型白名单。

本地缓存仍可保存任意模型译文；仅通过过滤且来自可信模型的条目会上报共享节点。
"""
from __future__ import annotations

import re
from typing import Optional

# 上报共享库时允许的模型（子串匹配，忽略大小写）。
# 本地 Ollama / 未知 / echo 等不在此列 → 只写本地缓存。
TRUSTED_MODEL_MARKERS = (
    "deepseek-chat",
    "deepseek-v4-flash",
    "deepseek-reasoner",
    "gpt-4o",
    "gpt-4.1",
    "gpt-4-turbo",
    "gemini-2",
    "gemini-1.5",
    "gemini-flash",
    "gemini-pro",
    "deepl",
    "align_repo",  # 仓库繁中对齐导入，质量可控
)

# 明确不可信（即使命中上面的子串也挡，例如含 deepseek 的本地乱填）
UNTRUSTED_MODEL_MARKERS = (
    "echo",
    "gemma",
    "llama",
    "qwen",
    "mistral",
    "phi-",
    "phi3",
    "tinyllama",
)

# 译文侧明显脏标记
_BAD_VALUE_SNIPPETS = (
    "没有识别到可翻译",
    "未配置翻译服务",
    "translation failed",
    "translate error",
    "rate limit",
    "api key",
    "invalid api",
    "error:",
    "exception",
    "traceback",
    "<html",
    "请先在命令行",
    "无法连接",
)

_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z\u00C0-\u024F]")
_ALPHA_RE = re.compile(r"[A-Za-z]")


def normalize_text(text: Optional[str]) -> Optional[str]:
    """Strip NULs / odd controls so cache keys match across packets and the shared dict."""
    if text is None:
        return None
    if not text:
        return text
    if "\x00" in text or any(ord(ch) < 32 and ch not in "\n\r\t" for ch in text):
        text = "".join(ch for ch in text if ch in "\n\r\t" or ord(ch) >= 32)
    return text.strip()


def normalize_model(model: Optional[str]) -> str:
    return (model or "").strip().lower()


def is_trusted_model(model: Optional[str]) -> bool:
    """是否允许把该模型的译文上报到共享词库。"""
    m = normalize_model(model)
    if not m or m in ("?", "unknown", "pretranslate", "ollama"):
        return False
    if any(bad in m for bad in UNTRUSTED_MODEL_MARKERS):
        # openrouter 的 deepseek/deepseek-chat 不含 untrusted；本地 qwen 会命中
        if "deepseek-chat" in m or "deepseek-v4" in m or "deepseek-reasoner" in m:
            pass
        else:
            return False
    return any(marker in m for marker in TRUSTED_MODEL_MARKERS)


def _looks_chinese_target(lang: Optional[str]) -> bool:
    lang = (lang or "zh-CN").lower()
    return lang.startswith("zh")


def is_clean_pair(
    k: Optional[str],
    v: Optional[str],
    target_lang: str = "zh-CN",
    source_lang: Optional[str] = None,
) -> bool:
    """原文 + 译文是否足够干净、值得共享。"""
    if k is None or v is None:
        return False
    k = str(k).strip()
    v = str(v).strip()
    if not k or not v:
        return False
    if len(k) > 4000 or len(v) > 4000:
        return False
    if "\ufffd" in k or "\ufffd" in v:
        return False
    if _CTRL_RE.search(k) or _CTRL_RE.search(v):
        return False

    try:
        from eco_source_lang import detect_source_lang, is_ambiguous_short, resolve_source_lang
    except Exception:
        detect_source_lang = None
        is_ambiguous_short = None
        resolve_source_lang = None

    src = source_lang
    if resolve_source_lang is not None:
        src = resolve_source_lang(k, source_lang or "auto")
    elif not src:
        src = "en"

    # Already-Chinese source, or Yes/No class keys, must not enter the shared dict.
    if src == "zh":
        return False
    if is_ambiguous_short is not None and is_ambiguous_short(k):
        return False

    if src == "ja":
        if not (_CJK_RE.search(k) or re.search(r"[\u3040-\u30ff]", k)):
            return False
    elif src == "id":
        if not _LATIN_RE.search(k):
            return False
    else:
        # 源文应像对话：至少有字母
        if not _LATIN_RE.search(k):
            return False
    # 过短的无意义源（单字母等），菜单项至少 2 字符
    if len(k) < 2:
        return False

    v_lower = v.lower()
    for snippet in _BAD_VALUE_SNIPPETS:
        if snippet in v_lower or snippet in v:
            return False

    # 未翻译：较长句子中英几乎相同
    if len(k) >= 8 and k.lower() == v_lower:
        return False

    if _looks_chinese_target(target_lang):
        cjk = len(_CJK_RE.findall(v))
        # 非琐碎源文至少要有汉字
        if len(k) >= 4 and cjk < 1:
            return False
        # 长译文汉字占比过低 → 多半仍是英文/乱码
        if len(v) >= 24 and cjk / max(len(v), 1) < 0.12:
            return False
        # 源文较长但译文几乎全是拉丁字母
        if len(k) >= 12:
            latin_v = len(_ALPHA_RE.findall(v))
            if cjk < 2 and latin_v >= 8:
                return False

    return True


def should_upload(
    k: Optional[str],
    v: Optional[str],
    model: Optional[str] = None,
    target_lang: str = "zh-CN",
    source_lang: Optional[str] = None,
) -> bool:
    """本地可缓存；返回 True 才允许进入共享上报队列。"""
    if not is_trusted_model(model):
        return False
    return is_clean_pair(k, v, target_lang=target_lang, source_lang=source_lang)


def reject_reason(
    k: Optional[str],
    v: Optional[str],
    model: Optional[str] = None,
    target_lang: str = "zh-CN",
    source_lang: Optional[str] = None,
) -> Optional[str]:
    """调试用：拒绝原因；通过则返回 None。"""
    if not is_trusted_model(model):
        return "untrusted_model"
    if not is_clean_pair(k, v, target_lang=target_lang, source_lang=source_lang):
        try:
            from eco_source_lang import is_ambiguous_short, resolve_source_lang

            src = resolve_source_lang(k, source_lang or "auto")
            if src == "zh":
                return "source_zh"
            if is_ambiguous_short(k):
                return "ambiguous_short"
        except Exception:
            pass
        return "dirty_text"
    return None
