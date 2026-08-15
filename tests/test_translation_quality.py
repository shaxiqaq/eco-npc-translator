# -*- coding: utf-8 -*-
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from eco_translation_quality import (  # noqa: E402
    is_clean_pair,
    is_trusted_model,
    normalize_text,
    reject_reason,
    should_upload,
)


class NormalizeTextTest(unittest.TestCase):
    def test_strips_space_nul_suffix(self):
        self.assertEqual(normalize_text("Alright, now give me 1 \n[Kitin]. \x00"), "Alright, now give me 1 \n[Kitin].")

    def test_strips_plain_nul(self):
        self.assertEqual(normalize_text("How can I help you?\x00"), "How can I help you?")

    def test_none_and_empty(self):
        self.assertIsNone(normalize_text(None))
        self.assertEqual(normalize_text(""), "")


class TrustedModelTest(unittest.TestCase):
    def test_deepseek_chat_trusted(self):
        self.assertTrue(is_trusted_model("deepseek-chat"))
        self.assertTrue(is_trusted_model("DeepSeek-Chat"))
        self.assertTrue(is_trusted_model("deepseek/deepseek-chat"))

    def test_flash_trusted(self):
        self.assertTrue(is_trusted_model("deepseek-v4-flash"))

    def test_openai_gemini_trusted(self):
        self.assertTrue(is_trusted_model("gpt-4o-mini"))
        self.assertTrue(is_trusted_model("openai/gpt-4o-mini"))
        self.assertTrue(is_trusted_model("gemini-2.0-flash"))
        self.assertTrue(is_trusted_model("google/gemini-flash-1.5"))

    def test_local_and_echo_untrusted(self):
        self.assertFalse(is_trusted_model("qwen2.5:7b"))
        self.assertFalse(is_trusted_model("gemma4:12b"))
        self.assertFalse(is_trusted_model("llama3.1:8b"))
        self.assertFalse(is_trusted_model("echo"))
        self.assertFalse(is_trusted_model("pretranslate"))
        self.assertFalse(is_trusted_model("?"))
        self.assertFalse(is_trusted_model(""))

    def test_align_repo_trusted(self):
        self.assertTrue(is_trusted_model("align_repo"))


class CleanPairTest(unittest.TestCase):
    def test_good_dialogue(self):
        self.assertTrue(
            is_clean_pair(
                "Do you want to exchange?",
                "要交换吗？",
            )
        )
        self.assertTrue(
            is_clean_pair(
                "Welcome to the Arena!!",
                "欢迎来到竞技场！！",
            )
        )

    def test_reject_empty_and_control(self):
        self.assertFalse(is_clean_pair("", "你好"))
        self.assertFalse(is_clean_pair("Hello", ""))
        self.assertFalse(is_clean_pair("Hello\x00world", "你好"))
        self.assertFalse(is_clean_pair("Hello", "你好\ufffd"))

    def test_reject_untranslated(self):
        self.assertFalse(
            is_clean_pair(
                "Do you want to exchange now please?",
                "Do you want to exchange now please?",
            )
        )

    def test_reject_no_chinese(self):
        self.assertFalse(
            is_clean_pair(
                "Welcome back adventurer!",
                "Welcome back adventurer!",
            )
        )
        self.assertFalse(
            is_clean_pair(
                "Talk to me again.",
                "Talk to me again later please.",
            )
        )

    def test_reject_error_snippets(self):
        self.assertFalse(
            is_clean_pair("Hello there friend", "API Key 无效")
        )
        self.assertFalse(
            is_clean_pair("Hello there friend", "无法连接本地 Ollama 服务")
        )


class ShouldUploadTest(unittest.TestCase):
    def test_upload_ok(self):
        self.assertTrue(
            should_upload(
                "Do you want to exchange?",
                "要交换吗？",
                "deepseek-chat",
            )
        )

    def test_block_untrusted_even_if_clean(self):
        self.assertFalse(
            should_upload(
                "Do you want to exchange?",
                "要交换吗？",
                "qwen2.5:7b",
            )
        )
        self.assertEqual(
            reject_reason(
                "Do you want to exchange?",
                "要交换吗？",
                "qwen2.5:7b",
            ),
            "untrusted_model",
        )

    def test_japanese_dialogue_uploadable(self):
        self.assertTrue(
            should_upload(
                "あなたは誰？　私はダークフェザーです。",
                "你是谁？我是暗羽。",
                "deepseek-chat",
                source_lang="ja",
            )
        )

    def test_indonesian_dialogue_uploadable(self):
        self.assertTrue(
            should_upload(
                "Apakah kamu ingin melepas IRIS Card sekarang?",
                "你现在想卸下 IRIS 卡片吗？",
                "deepseek-chat",
                source_lang="id",
            )
        )

    def test_block_short_yes_no(self):
        self.assertFalse(should_upload("Yes", "是", "deepseek-chat"))
        self.assertEqual(reject_reason("Yes", "是", "deepseek-chat"), "ambiguous_short")
        self.assertFalse(should_upload("No", "不", "deepseek-chat"))

    def test_block_already_chinese_source(self):
        self.assertFalse(
            should_upload("你想交换吗？再跟我谈谈吧。", "你想交换吗？再跟我谈谈吧。", "deepseek-chat")
        )
        self.assertEqual(
            reject_reason("你想交换吗？再跟我谈谈吧。", "你想交换吗？再跟我谈谈吧。", "deepseek-chat"),
            "source_zh",
        )

    def test_block_dirty_even_if_trusted(self):
        self.assertFalse(
            should_upload(
                "Hello there friend",
                "Hello there friend",
                "deepseek-chat",
            )
        )
        self.assertEqual(
            reject_reason(
                "Hello there friend",
                "Hello there friend",
                "deepseek-chat",
            ),
            "dirty_text",
        )


class PromptImportTest(unittest.TestCase):
    def test_prompts_importable(self):
        sys.path.insert(0, ROOT)
        from screen_translator.prompts import ECO_SYSTEM_SINGLE, ECO_GLOSSARY

        self.assertIn("Marionette", ECO_GLOSSARY)
        self.assertIn("ECO", ECO_SYSTEM_SINGLE)
        self.assertIn("glossary", ECO_SYSTEM_SINGLE.lower() + ECO_GLOSSARY.lower())


if __name__ == "__main__":
    unittest.main()
