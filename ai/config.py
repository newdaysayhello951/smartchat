"""Reload model settings, never unrelated secrets, from the native env file."""
import os
from pathlib import Path


def llm_settings():
    names = ("DEEPSEEK_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL")
    settings = {name: os.getenv(name, "") for name in names}
    filename = os.getenv("PROJECT_ENV_FILE")
    if filename:
        for line in Path(filename).read_text(encoding="utf-8-sig").splitlines():
            if line.lstrip().startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            name, value = name.strip(), value.strip()
            if name not in names:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            settings[name] = value
    return settings


def completion_url(base):
    base = (base or "https://api.deepseek.com").strip().rstrip("/")
    return base if base.endswith("/chat/completions") else base + "/chat/completions"


def model_id(value):
    # Human shorthand is not a valid official API model identifier.
    value = (value or "deepseek-flash").strip()
    return "deepseek-flash" if value.lower() in ("dsv4.1flash", "deepseek-v4.1-flash", "deepseek-v4.1-flash-1017") else value
