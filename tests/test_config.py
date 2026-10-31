import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ai'))
from config import llm_settings


def test_native_key_reloads_without_restart(tmp_path,monkeypatch):
    file=tmp_path/'.env'
    monkeypatch.setenv('PROJECT_ENV_FILE',str(file))
    monkeypatch.setenv('LLM_API_KEY','old-process-key')
    file.write_text('LLM_API_KEY="new-file-key"\nDB_PASSWORD=not-a-model-setting\n',encoding='utf-8-sig')
    assert llm_settings()['LLM_API_KEY']=='new-file-key'
    file.write_text('LLM_API_KEY=updated-again\n',encoding='utf-8')
    assert llm_settings()['LLM_API_KEY']=='updated-again'
    assert 'DB_PASSWORD' not in llm_settings()
