import asyncio
import importlib
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ai'))
from config import completion_url, model_id


def test_official_model_alias_and_endpoint():
    assert model_id('dsv4.1flash')=='deepseek-flash'
    assert model_id('deepseek-v4.1-flash')=='deepseek-flash'
    assert model_id('deepseek-flash')=='deepseek-flash'
    assert completion_url('')=='https://api.deepseek.com/chat/completions'
    assert completion_url('https://api.deepseek.com/v1/')=='https://api.deepseek.com/v1/chat/completions'
    assert completion_url('https://api.deepseek.com/chat/completions')=='https://api.deepseek.com/chat/completions'


@pytest.mark.parametrize('status,message',[(401,'密钥无效'),(402,'余额不足'),(400,'参数或模型名'),(429,'过于频繁')])
def test_official_key_header_and_errors(tmp_path,monkeypatch,status,message):
    monkeypatch.setenv('INDEX_DIR',str(tmp_path/'index'))
    monkeypatch.delenv('PROJECT_ENV_FILE',raising=False)
    monkeypatch.setenv('DEEPSEEK_API_KEY','official-test-key')
    monkeypatch.setenv('LLM_API_KEY','old-provider-key-must-not-be-used')
    monkeypatch.setenv('LLM_BASE_URL','https://api.deepseek.com')
    sys.modules.pop('app',None)
    ai=importlib.import_module('app')
    def handler(request):
        assert request.headers['Authorization']=='Bearer official-test-key'
        assert request.headers['Content-Type']=='application/json'
        return httpx.Response(status,json={'error':{'message':'test error'}})
    original=httpx.AsyncClient
    monkeypatch.setattr(ai.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
    with pytest.raises(ValueError,match=message):
        asyncio.run(ai.complete('test','test'))
