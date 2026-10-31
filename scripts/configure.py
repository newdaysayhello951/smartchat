"""Create a local configuration without displaying credentials or overwriting edits."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
target = root / ".env"
text = target.read_text(encoding="utf-8-sig") if target.exists() else (root / ".env.example").read_text(encoding="utf-8")
for old in ("change-this-database-password", "change-this-root-password", "replace-with-a-long-random-secret"):
    text = text.replace(old, secrets.token_hex(24))
target.write_text(text, encoding="utf-8")
print("Local .env prepared. Fill DEEPSEEK_API_KEY in your editor; do not share this file.")
