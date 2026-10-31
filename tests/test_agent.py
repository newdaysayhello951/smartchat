import asyncio
import importlib
import json
from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ai'))
from agent_tools import run_agent

@pytest.fixture
def ai(tmp_path,monkeypatch):
    monkeypatch.setenv('INDEX_DIR',str(tmp_path/'index'))
    monkeypatch.setenv('FILE_DIR',str(tmp_path/'files'))
    monkeypatch.setenv('INTERNAL_SECRET','testing-internal-secret-32chars')
    (tmp_path/'files').mkdir()
    sys.modules.pop('app',None)
    return importlib.import_module('app')

def call(name,args,id='call_1'):
    return {'id':id,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}

def test_agent_search_loop_and_citation(ai):
    steps=[]
    async def model(messages,tools):
        steps.append(messages.copy())
        if len(steps)==1:return {'content':None,'tool_calls':[call('search_conversation',{'query':'杭州预算'})]}
        result=json.loads(messages[-1]['content'])
        assert result['sources'][0]['citation']==1
        return {'content':'预算两千元 [1]。'}
    async def complete(*args):raise AssertionError('no extra generation needed')
    data=ai.JobInput(conversation_id='1',mode='agent',question='杭州预算',messages=[{'seq':'9','username':'Alice','content':'杭州预算每人两千元。'}])
    result=asyncio.run(run_agent(data,ai.database,model,complete))
    assert result['answer']=='预算两千元 [1]。'
    assert result['citations'][0]['seq']=='9'
    assert result['steps'][0]['tool']=='search_conversation'

def test_agent_rejects_other_conversation_file(ai):
    count=0
    async def model(messages,tools):
        nonlocal count
        count+=1
        if count==1:return {'tool_calls':[call('summarize_file',{'file_id':'b'*32})]}
        assert '不属于当前会话' in messages[-1]['content']
        return {'content':'无法访问此文件。'}
    async def complete(*args):raise AssertionError('unauthorized source must not call model')
    result=asyncio.run(run_agent(ai.JobInput(conversation_id='1',mode='agent',question='总结其他文件',files=[{'id':'a'*32,'name':'mine.txt'}]),ai.database,model,complete))
    assert result['steps'][0]['status']=='failed'

def test_agent_tool_limit_and_allowlist(ai):
    async def model(messages,tools):return {'tool_calls':[call('send_message',{},str(len(messages)))]}
    async def complete(*args):raise AssertionError('unknown tools must not execute')
    result=asyncio.run(run_agent(ai.JobInput(conversation_id='1',mode='agent',question='发消息'),ai.database,model,complete))
    assert len(result['steps'])==4
    assert all(step['status']=='failed' for step in result['steps'])
    assert result['model_calls']<=8

def test_agent_travel_plan_uses_scoped_sources(ai):
    count=0
    async def model(messages,tools):
        nonlocal count
        count+=1
        return {'tool_calls':[call('generate_travel_plan',{'requirements':'杭州预算'})]} if count==1 else {'content':'行程草案见工具结果 [1]。'}
    async def complete(system,text):
        assert '不得声称查过票价' in system
        assert '杭州预算每人两千元' in text
        return '建议在预算内安排行程，车票需确认。'
    result=asyncio.run(run_agent(ai.JobInput(conversation_id='1',mode='agent',question='杭州预算',messages=[{'seq':'1','username':'A','content':'杭州预算每人两千元'}]),ai.database,model,complete))
    assert result['steps'][0]['tool']=='generate_travel_plan'
    assert result['model_calls']==3

def test_agent_model_tool_request_contract(ai,monkeypatch):
    import httpx
    seen={}
    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200,json={'choices':[{'message':{'content':None,'tool_calls':[call('search_conversation',{'query':'预算'})]}}]})
    original=httpx.AsyncClient
    monkeypatch.setenv('LLM_API_KEY','test-key-not-real')
    monkeypatch.setattr(ai.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
    from agent_tools import TOOLS
    output=asyncio.run(ai.model_request([{'role':'user','content':'test'}],TOOLS))
    assert seen['tool_choice']=='auto'
    assert seen['thinking']=={'type':'disabled'}
    assert 'enable_thinking' not in seen
    assert len(seen['tools'])==4
    assert output['tool_calls'][0]['function']['name']=='search_conversation'
