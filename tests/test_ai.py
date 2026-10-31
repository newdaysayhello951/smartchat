import importlib
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ai"))
from retrieval import chunks, cosine, retrieve, vector


def test_chinese_retrieval_and_threshold():
    rows = [{"text": "杭州旅行预算每人两千元，周六早上出发", "vector": vector("杭州旅行预算每人两千元，周六早上出发")},
            {"text": "服务器采用八个工作线程", "vector": vector("服务器采用八个工作线程")}]
    assert retrieve(rows, "杭州旅行预算")[0]["text"].startswith("杭州")
    assert retrieve(rows, "quantum physics") == []
    assert cosine(vector("hello"), vector("hello")) == pytest.approx(1)


def test_chunk_coverage():
    text = "abcdefghijklmnopqrstuvwxyz"*90
    parts = chunks(text)
    assert max(map(len, parts)) <= 900
    assert parts[0][-150:] == parts[1][:150]
    assert parts[-1].endswith(text[-50:])


@pytest.fixture
def ai(tmp_path, monkeypatch):
    monkeypatch.setenv("INDEX_DIR", str(tmp_path / "index"))
    monkeypatch.setenv("FILE_DIR", str(tmp_path / "files"))
    monkeypatch.setenv("INTERNAL_SECRET", "test-secret-with-32-characters")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    (tmp_path / "files").mkdir()
    sys.modules.pop("app", None)
    return importlib.import_module("app")


def test_index_and_conversation_isolation(ai):
    file_id = "a"*32
    (ai.FILE_DIR / file_id).write_text("杭州旅行预算每人两千元。", encoding="utf-8")
    result = ai.extract(ai.IndexInput(file_id=file_id, conversation_id="1", name="攻略.txt"))
    assert result["indexed_chunks"] == 1
    import asyncio
    result = asyncio.run(ai.answer(ai.JobInput(conversation_id="2", mode="ask", question="杭州旅行预算")))
    assert result["citations"] == []
    assert "未检索到" in result["answer"]


def test_openai_compatible_request(ai, monkeypatch):
    captured = {}
    def handler(request):
        captured["headers"] = request.headers
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "测试答案"}}]})
    original = httpx.AsyncClient
    monkeypatch.setenv("LLM_API_KEY", "test-key-not-real")
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    import asyncio
    assert asyncio.run(ai.complete("system", "你好")) == "测试答案"
    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key-not-real"
    assert captured["body"]["model"] == "deepseek-flash"
    assert captured["body"]["thinking"] == {"type":"disabled"}
    assert "enable_thinking" not in captured["body"]
    assert captured["headers"]["Content-Type"] == "application/json"
    assert captured["body"]["stream"] is False


def test_missing_key_and_internal_auth(ai):
    import asyncio
    with pytest.raises(ValueError, match="DEEPSEEK_API_KEY"):
        asyncio.run(ai.complete("system", "hi"))
    from fastapi.testclient import TestClient
    with TestClient(ai.app) as client:
        assert client.post("/status", json={"id": "a"*32}).status_code == 403
        assert client.post("/index", headers={"X-Internal-Secret": "test-secret-with-32-characters"}, json={"file_id": "../escape", "conversation_id": "1", "name": "x.txt"}).status_code == 422


def test_job_failure_is_persisted(ai):
    import asyncio
    async def failure():
        raise ValueError("expected failure")
    asyncio.run(ai.execute("b"*32, failure))
    with ai.database() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", ("b"*32,)).fetchone()
    assert row["status"] == "failed"
    assert json.loads(row["result"])["error"] == "expected failure"


def test_chat_citations(ai, monkeypatch):
    async def mock_complete(*args):
        return "预算为两千元 [1]。"
    monkeypatch.setattr(ai, "complete", mock_complete)
    import asyncio
    result = asyncio.run(ai.answer(ai.JobInput(conversation_id="1", mode="ask", question="杭州预算",
        messages=[{"seq": "17", "username": "Alice", "content": "杭州预算每人两千元。"}])))
    assert result["citations"][0]["seq"] == "17"
    assert result["citations"][0]["file_id"] is None


def test_summary_is_chunked(ai, monkeypatch):
    calls = []
    async def mock_complete(system, text):
        calls.append(text)
        return "分段摘要 #1"
    monkeypatch.setattr(ai, "complete", mock_complete)
    import asyncio
    output = asyncio.run(ai.summarize(ai.JobInput(conversation_id="1", mode="summary",
        messages=[{"seq": "1", "created_at": "2026-01-01", "username": "Alice", "content": "预算"*6000}])))
    assert len(calls) == 3
    assert output["message_count"] == 1
