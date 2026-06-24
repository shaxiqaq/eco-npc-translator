from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent


@dataclass(slots=True)
class OcrConfig:
    provider: str = "tesseract"
    tesseract_cmd: str = ""
    tessdata_dir: str = ""


@dataclass(slots=True)
class TranslationConfig:
    provider: str = "openai"
    model: str = "gpt-4.1-mini"
    base_url: str = ""
    api_key: str = ""


@dataclass(slots=True)
class OverlayConfig:
    width: int = 520
    height: int = 360
    opacity: float = 0.94


@dataclass(slots=True)
class AppConfig:
    source_language: str = "auto"
    target_language: str = "zh-CN"
    hotkey: str = "ctrl+alt+t"
    auto_monitor_hotkey: str = "ctrl+alt+m"
    capture_mode: str = "active_window"
    selected_window_title: str = ""
    auto_monitor_enabled: bool = False
    auto_monitor_interval: float = 2.0
    region_left: int = 0
    region_top: int = 0
    region_width: int = 0
    region_height: int = 0
    region_relative: bool = True
    display_custom_enabled: bool = False
    display_left: int = 0
    display_top: int = 0
    display_width: int = 0
    display_height: int = 0
    ocr: OcrConfig = field(default_factory=OcrConfig)
    translation: TranslationConfig = field(default_factory=TranslationConfig)
    overlay: OverlayConfig = field(default_factory=OverlayConfig)


def _merge(defaults: dict[str, Any], user_values: dict[str, Any]) -> dict[str, Any]:
    merged = dict(defaults)
    for key, value in user_values.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: Path | None = None) -> AppConfig:
    path = path or ROOT / "config.json"
    default_path = ROOT / "config.example.json"
    values: dict[str, Any] = {}

    if default_path.exists():
        values = json.loads(default_path.read_text(encoding="utf-8-sig"))

    if path.exists():
        values = _merge(values, json.loads(path.read_text(encoding="utf-8-sig")))

    return AppConfig(
        source_language=values.get("source_language", "auto"),
        target_language=values.get("target_language", "zh-CN"),
        hotkey=values.get("hotkey", "ctrl+alt+t"),
        auto_monitor_hotkey=values.get("auto_monitor_hotkey", "ctrl+alt+m"),
        capture_mode=values.get("capture_mode", "active_window"),
        selected_window_title=values.get("selected_window_title", ""),
        auto_monitor_enabled=values.get("auto_monitor_enabled", False),
        auto_monitor_interval=float(values.get("auto_monitor_interval", 2.0)),
        region_left=values.get("region_left", 0),
        region_top=values.get("region_top", 0),
        region_width=values.get("region_width", 0),
        region_height=values.get("region_height", 0),
        region_relative=values.get("region_relative", True),
        display_custom_enabled=values.get("display_custom_enabled", False),
        display_left=values.get("display_left", 0),
        display_top=values.get("display_top", 0),
        display_width=values.get("display_width", 0),
        display_height=values.get("display_height", 0),
        ocr=OcrConfig(**values.get("ocr", {})),
        translation=TranslationConfig(**values.get("translation", {})),
        overlay=OverlayConfig(**values.get("overlay", {})),
    )


def save_config(config: AppConfig, path: Path | None = None) -> None:
    path = path or ROOT / "config.json"
    payload = asdict(config)
    path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
