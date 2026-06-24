from __future__ import annotations

import os
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib import parse as urlparse
import json
import uuid

from .config import TranslationConfig


NO_TEXT_MESSAGE = "\u6ca1\u6709\u8bc6\u522b\u5230\u53ef\u7ffb\u8bd1\u7684\u6587\u5b57\u3002"
ECHO_PREFIX = "[\u672a\u914d\u7f6e\u7ffb\u8bd1\u670d\u52a1\uff0c\u4ee5\u4e0b\u4e3a OCR \u539f\u6587]"


class Translator:
    def translate(self, text: str, source_language: str, target_language: str) -> str:
        raise NotImplementedError

    def translate_many(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
    ) -> list[str]:
        return [self.translate(text, source_language, target_language) for text in texts]


class OpenAITranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        from openai import OpenAI

        self._client = OpenAI(
            api_key=config.api_key or os.environ.get("OPENAI_API_KEY") or "local",
            base_url=config.base_url or None,
        )
        self._model = config.model

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a game localization translator for RPG dialogue and UI text. "
                        "Translate the entire OCR text into natural, fluent Chinese, with a tone that fits game dialogue. "
                        "Do not translate word by word; rewrite awkward OCR text into idiomatic Chinese while preserving the original meaning. "
                        "Never omit short fragments, repeated words, ellipses, names, or sentence endings. "
                        "OCR may split contractions, for example \"I' m\", \"it' s\", \"don' t\", or \"he' s\"; recover them before translating. "
                        "Keep character names and proper nouns readable, transliterating only when appropriate. "
                        "Return only the translation, without explanations."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source language: {source_language}\n"
                        f"Target language: {target_language}\n\n"
                        f"{text}"
                    ),
                },
            ],
            temperature=0.4,
        )
        content = response.choices[0].message.content or ""
        return content.strip()

    def translate_many(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
    ) -> list[str]:
        clean_texts = [text.strip() for text in texts]
        if not any(clean_texts):
            return [""] * len(texts)

        numbered = "\n".join(
            f"{index + 1}. {text}"
            for index, text in enumerate(clean_texts)
        )
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a game localization translator for RPG dialogue and UI text. "
                        "Translate each numbered item into natural, fluent Chinese. "
                        "Preserve the full meaning and do not omit short fragments, names, punctuation, or sentence endings. "
                        "OCR may split contractions; recover them before translating. "
                        "Return exactly one translated line per input item in the form 'number. translation'. "
                        "Do not merge, skip, explain, or add extra text."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source language: {source_language}\n"
                        f"Target language: {target_language}\n\n"
                        f"{numbered}"
                    ),
                },
            ],
            temperature=0.3,
        )
        content = response.choices[0].message.content or ""
        parsed = _parse_numbered_translations(content, len(texts))
        return parsed or super().translate_many(texts, source_language, target_language)


class DeepSeekTranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        from openai import OpenAI

        self._client = OpenAI(
            api_key=config.api_key or os.environ.get("DEEPSEEK_API_KEY"),
            base_url=config.base_url or "https://api.deepseek.com",
        )
        self._model = config.model or "deepseek-v4-flash"

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a game localization translator for RPG dialogue and UI text. "
                        "Translate the entire OCR text into natural, fluent Chinese, with a tone that fits game dialogue. "
                        "Do not translate word by word; rewrite awkward OCR text into idiomatic Chinese while preserving the original meaning. "
                        "Never omit short fragments, repeated words, ellipses, names, or sentence endings. "
                        "OCR may split contractions, for example \"I' m\", \"it' s\", \"don' t\", or \"he' s\"; recover them before translating. "
                        "Keep character names and proper nouns readable, transliterating only when appropriate. "
                        "Return only the translation, without explanations."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source language: {source_language}\n"
                        f"Target language: {target_language}\n\n"
                        f"{text}"
                    ),
                },
            ],
            temperature=0.4,
        )
        content = response.choices[0].message.content or ""
        return content.strip()

    def translate_many(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
    ) -> list[str]:
        clean_texts = [text.strip() for text in texts]
        if not any(clean_texts):
            return [""] * len(texts)

        numbered = "\n".join(
            f"{index + 1}. {text}"
            for index, text in enumerate(clean_texts)
        )
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a game localization translator for RPG dialogue and UI text. "
                        "Translate each numbered item into natural, fluent Chinese. "
                        "Preserve the full meaning and do not omit short fragments, names, punctuation, or sentence endings. "
                        "OCR may split contractions; recover them before translating. "
                        "Return exactly one translated line per input item in the form 'number. translation'. "
                        "Do not merge, skip, explain, or add extra text."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source language: {source_language}\n"
                        f"Target language: {target_language}\n\n"
                        f"{numbered}"
                    ),
                },
            ],
            temperature=0.3,
        )
        content = response.choices[0].message.content or ""
        parsed = _parse_numbered_translations(content, len(texts))
        return parsed or super().translate_many(texts, source_language, target_language)


class OpenRouterTranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        from openai import OpenAI

        self._client = OpenAI(
            api_key=config.api_key or os.environ.get("OPENROUTER_API_KEY"),
            base_url=config.base_url or "https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://local.screen-translator",
                "X-OpenRouter-Title": "Screen Translator",
            },
        )
        self._model = config.model or "openrouter/auto"

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a game localization translator for RPG dialogue and UI text. "
                        "Translate the entire OCR text into natural, fluent Chinese, with a tone that fits game dialogue. "
                        "Do not translate word by word; rewrite awkward OCR text into idiomatic Chinese while preserving the original meaning. "
                        "Never omit short fragments, repeated words, ellipses, names, or sentence endings. "
                        "OCR may split contractions, for example \"I' m\", \"it' s\", \"don' t\", or \"he' s\"; recover them before translating. "
                        "Keep character names and proper nouns readable, transliterating only when appropriate. "
                        "Return only the translation, without explanations."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source language: {source_language}\n"
                        f"Target language: {target_language}\n\n"
                        f"{text}"
                    ),
                },
            ],
            temperature=0.4,
        )
        content = response.choices[0].message.content or ""
        return content.strip()


class GeminiTranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        from google import genai

        api_key = config.api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        self._client = genai.Client(api_key=api_key)
        self._model = config.model

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        prompt = (
            "You are a precise screen translation engine.\n"
            "Translate UI text naturally and concisely.\n"
            "Preserve line breaks when helpful.\n"
            "Return only the translation.\n\n"
            f"Source language: {source_language}\n"
            f"Target language: {target_language}\n\n"
            f"{text}"
        )
        response = self._client.models.generate_content(
            model=self._model,
            contents=prompt,
        )
        return (response.text or "").strip()


class CloudflareWorkersAITranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        account_id, api_token = _split_prefix_secret(
            config.api_key or os.environ.get("CLOUDFLARE_AI_API_KEY", "")
        )
        self._account_id = account_id or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
        self._api_token = api_token
        self._base_url = (config.base_url or "https://api.cloudflare.com/client/v4").rstrip("/")
        self._model = config.model or "@cf/google/gemma-3-12b-it"

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        prompt = (
            "You are a game localization translator for RPG dialogue and UI text.\n"
            "Translate the entire OCR text naturally into the target language.\n"
            "Preserve the full meaning and never omit short fragments.\n"
            "Return only the translation.\n\n"
            f"Source language: {source_language}\n"
            f"Target language: {target_language}\n\n"
            f"{text}"
        )
        payload = {
            "messages": [
                {
                    "role": "system",
                    "content": "You are a precise game translation engine.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ]
        }
        data = self._post_json(
            f"{self._base_url}/accounts/{self._account_id}/ai/run/{self._model}",
            payload,
            {"Authorization": f"Bearer {self._api_token}"},
        )
        result = data.get("result") or {}
        if isinstance(result, dict):
            response = result.get("response") or result.get("text") or ""
            if response:
                return str(response).strip()
            choices = result.get("choices") or []
            if choices:
                message = choices[0].get("message") or {}
                return str(message.get("content") or "").strip()
        return str(result).strip()

    def _post_json(self, url: str, payload: dict[str, object], headers: dict[str, str]) -> dict[str, object]:
        body = json.dumps(payload).encode("utf-8")
        request = urlrequest.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", **headers},
            method="POST",
        )
        with urlrequest.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))


class DeepLTranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        self._api_key = config.api_key or os.environ.get("DEEPL_API_KEY", "")
        self._base_url = (config.base_url or "https://api-free.deepl.com/v2").rstrip("/")

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        params = {
            "text": text,
            "target_lang": _to_deepl_language(target_language),
        }
        source = _to_deepl_language(source_language, source=True)
        if source:
            params["source_lang"] = source
        body = urlparse.urlencode(params).encode("utf-8")
        request = urlrequest.Request(
            f"{self._base_url}/translate",
            data=body,
            headers={
                "Authorization": f"DeepL-Auth-Key {self._api_key}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )
        with urlrequest.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
        translations = data.get("translations") or []
        if translations:
            return str(translations[0].get("text") or "").strip()
        return ""


class AzureTranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        region, key = _split_prefix_secret(
            config.api_key or os.environ.get("AZURE_TRANSLATOR_KEY", "")
        )
        self._region = region or os.environ.get("AZURE_TRANSLATOR_REGION", "")
        self._key = key
        self._base_url = (config.base_url or "https://api.cognitive.microsofttranslator.com").rstrip("/")

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        query = {
            "api-version": "3.0",
            "to": _to_azure_language(target_language),
        }
        source = _to_azure_language(source_language, source=True)
        if source:
            query["from"] = source
        url = f"{self._base_url}/translate?{urlparse.urlencode(query)}"
        payload = [{"text": text}]
        request = urlrequest.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Ocp-Apim-Subscription-Key": self._key,
                "Ocp-Apim-Subscription-Region": self._region,
                "Content-Type": "application/json",
                "X-ClientTraceId": str(uuid.uuid4()),
            },
            method="POST",
        )
        with urlrequest.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
        if data and data[0].get("translations"):
            return str(data[0]["translations"][0].get("text") or "").strip()
        return ""


class OllamaTranslator(Translator):
    def __init__(self, config: TranslationConfig) -> None:
        self._base_url = (config.base_url or "http://127.0.0.1:11434").rstrip("/")
        if self._base_url.endswith("/v1"):
            self._base_url = self._base_url[:-3]
        self._model = config.model or "gemma4:12b"

    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE

        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a game localization translator for RPG dialogue and UI text. "
                        "Translate naturally and return only the translation."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source language: {source_language}\n"
                        f"Target language: {target_language}\n\n"
                        f"{text}"
                    ),
                },
            ],
            "stream": False,
            "think": False,
            "options": {
                "temperature": 0.4,
                "num_predict": 512,
            },
        }
        return self._post_chat(payload)

    def translate_many(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
    ) -> list[str]:
        clean_texts = [text.strip() for text in texts]
        if not any(clean_texts):
            return [""] * len(texts)

        numbered = "\n".join(
            f"{index + 1}. {text}"
            for index, text in enumerate(clean_texts)
        )
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Translate each numbered item into natural Chinese. "
                        "Return exactly one translated line per input item in the form 'number. translation'. "
                        "Do not explain."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Source language: {source_language}\n"
                        f"Target language: {target_language}\n\n"
                        f"{numbered}"
                    ),
                },
            ],
            "stream": False,
            "think": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 1024,
            },
        }
        parsed = _parse_numbered_translations(self._post_chat(payload), len(texts))
        return parsed or super().translate_many(texts, source_language, target_language)

    def _post_chat(self, payload: dict[str, object]) -> str:
        try:
            return self._post_ollama_chat(payload)
        except urlerror.HTTPError as exc:
            error_text = _read_http_error(exc)
            if exc.code == 404 and _is_ollama_model_missing(error_text):
                raise RuntimeError(
                    "本地 Ollama 模型不存在或还没有下载。\n\n"
                    f"当前模型：{self._model}\n\n"
                    "请先在命令行运行：\n"
                    f"ollama pull {self._model}"
                ) from exc
            if exc.code == 404:
                try:
                    return self._post_openai_compatible_chat(payload)
                except Exception as fallback_exc:
                    raise RuntimeError(
                        "本地 AI 接口返回 404，可能是接口类型选错了。\n\n"
                        f"当前地址：{self._base_url}\n"
                        f"当前模型：{self._model}\n\n"
                        "如果你使用 Ollama，请确认已经运行 `ollama serve`，并执行：\n"
                        f"ollama pull {self._model}\n\n"
                        "如果你使用 LM Studio、vLLM 或其他 OpenAI 兼容服务，"
                        "请在设置里选择“本地 AI - OpenAI 兼容接口”。"
                    ) from fallback_exc
            raise RuntimeError(
                "本地 Ollama 请求失败。\n\n"
                f"HTTP {exc.code}: {error_text or exc.reason}"
            ) from exc
        except urlerror.URLError as exc:
            raise RuntimeError(
                "无法连接本地 Ollama 服务。\n\n"
                f"当前地址：{self._base_url}\n\n"
                "请确认已经启动：\n"
                "ollama serve"
            ) from exc

    def _post_ollama_chat(self, payload: dict[str, object]) -> str:
        body = json.dumps(payload).encode("utf-8")
        request = urlrequest.Request(
            f"{self._base_url}/api/chat",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlrequest.urlopen(request, timeout=120) as response:
            data = json.loads(response.read().decode("utf-8"))
        message = data.get("message") or {}
        content = message.get("content") or ""
        return content.strip()

    def _post_openai_compatible_chat(self, payload: dict[str, object]) -> str:
        messages = payload.get("messages") or []
        body = json.dumps(
            {
                "model": self._model,
                "messages": messages,
                "stream": False,
                "temperature": 0.4,
            }
        ).encode("utf-8")
        request = urlrequest.Request(
            f"{self._base_url}/v1/chat/completions",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlrequest.urlopen(request, timeout=120) as response:
            data = json.loads(response.read().decode("utf-8"))
        choices = data.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content") or ""
        return content.strip()


def _read_http_error(exc: urlerror.HTTPError) -> str:
    try:
        raw = exc.read()
    except Exception:
        return ""
    if not raw:
        return ""
    try:
        data = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception:
        return raw.decode("utf-8", errors="replace").strip()
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, str):
            return error.strip()
        if isinstance(error, dict):
            message = error.get("message") or error.get("error")
            if message:
                return str(message).strip()
        message = data.get("message")
        if message:
            return str(message).strip()
    return json.dumps(data, ensure_ascii=False)


def _is_ollama_model_missing(error_text: str) -> bool:
    normalized = error_text.lower()
    return "model" in normalized and (
        "not found" in normalized
        or "pull" in normalized
        or "not installed" in normalized
    )


class EchoTranslator(Translator):
    def translate(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return NO_TEXT_MESSAGE
        return f"{ECHO_PREFIX}\n{text}"

    def translate_many(
        self,
        texts: list[str],
        source_language: str,
        target_language: str,
    ) -> list[str]:
        return texts


def create_translator(config: TranslationConfig) -> Translator:
    if config.provider == "cloudflare":
        account_id, api_token = _split_prefix_secret(
            config.api_key or os.environ.get("CLOUDFLARE_AI_API_KEY", "")
        )
        if not ((account_id or os.environ.get("CLOUDFLARE_ACCOUNT_ID")) and api_token):
            return EchoTranslator()
        return CloudflareWorkersAITranslator(config)
    if config.provider == "deepl":
        if not (config.api_key or os.environ.get("DEEPL_API_KEY")):
            return EchoTranslator()
        return DeepLTranslator(config)
    if config.provider == "azure":
        region, key = _split_prefix_secret(
            config.api_key or os.environ.get("AZURE_TRANSLATOR_KEY", "")
        )
        if not ((region or os.environ.get("AZURE_TRANSLATOR_REGION")) and key):
            return EchoTranslator()
        return AzureTranslator(config)
    if config.provider == "openrouter":
        if not (config.api_key or os.environ.get("OPENROUTER_API_KEY")):
            return EchoTranslator()
        return OpenRouterTranslator(config)
    if config.provider == "deepseek":
        if not (config.api_key or os.environ.get("DEEPSEEK_API_KEY")):
            return EchoTranslator()
        return DeepSeekTranslator(config)
    if config.provider == "gemini":
        if not (config.api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
            return EchoTranslator()
        return GeminiTranslator(config)
    if config.provider == "ollama":
        return OllamaTranslator(config)
    if config.provider == "openai":
        if not (config.api_key or os.environ.get("OPENAI_API_KEY") or config.base_url):
            return EchoTranslator()
        return OpenAITranslator(config)
    if config.provider == "echo":
        return EchoTranslator()
    raise ValueError(f"\u4e0d\u652f\u6301\u7684\u7ffb\u8bd1\u670d\u52a1\uff1a{config.provider}")


def _split_prefix_secret(value: str) -> tuple[str, str]:
    if "|" not in value:
        return "", value.strip()
    prefix, secret = value.split("|", 1)
    return prefix.strip(), secret.strip()


def _to_deepl_language(language: str, source: bool = False) -> str:
    if source and language == "auto":
        return ""
    mapping = {
        "zh-CN": "ZH-HANS",
        "zh-TW": "ZH-HANT",
        "en": "EN",
        "ja": "JA",
        "ko": "KO",
        "fr": "FR",
        "de": "DE",
        "es": "ES",
        "ru": "RU",
    }
    return mapping.get(language, "ZH-HANS" if not source else "")


def _to_azure_language(language: str, source: bool = False) -> str:
    if source and language == "auto":
        return ""
    mapping = {
        "zh-CN": "zh-Hans",
        "zh-TW": "zh-Hant",
        "en": "en",
        "ja": "ja",
        "ko": "ko",
        "fr": "fr",
        "de": "de",
        "es": "es",
        "ru": "ru",
    }
    return mapping.get(language, "zh-Hans" if not source else "")


def _parse_numbered_translations(text: str, expected_count: int) -> list[str]:
    results = [""] * expected_count
    matched = 0
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        number = ""
        index = 0
        while index < len(line) and line[index].isdigit():
            number += line[index]
            index += 1
        if not number:
            continue
        while index < len(line) and line[index] in ".\u3001):\uff1a ":
            index += 1
        try:
            item_index = int(number) - 1
        except ValueError:
            continue
        if 0 <= item_index < expected_count:
            results[item_index] = line[index:].strip()
            matched += 1
    return results if matched else []
