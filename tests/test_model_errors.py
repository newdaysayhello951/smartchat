import importlib
import sys
from pathlib import Path
import asyncio
import httpx
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ai'))

def test_model_timeout_is_actionable(tmp_path,monkeypatch):
    monkeypatch.setenv('INDEX_DIR',str(tmp_path/'index'))
    monkeypatch.delenv('PROJECT_ENV_FILE',raising=False)
    monkeypatch.setenv('LLM_API_KEY','test-key-not-real')
    sys.modules.pop('app',None)
    ai=importlib.import_module('app')
    def handler(request):raise httpx.ReadTimeout('test timeout',request=request)
    original=httpx.AsyncClient
    monkeypatch.setattr(ai.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
    with pytest.raises(ValueError,match='模型接口响应超时'):
        asyncio.run(ai.complete('test','test'))
