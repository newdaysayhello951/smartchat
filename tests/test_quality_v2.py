import asyncio
import importlib
import json
from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ai'))
from semantic import embedding,similarity
from retrieval import index_vector,retrieve_hybrid
from grounding import check_citations,audit_answer

def test_real_semantic_paraphrase():
    text='每位参加者需要准备两千元。'
    query='这个活动人均要花多少钱？'
    assert len(embedding(text))==384
    assert similarity(embedding(text),embedding(query))>similarity(embedding(text),embedding('明天的天气怎么样？'))+.2
    rows=[{'text':text,'vector':index_vector(text),'file_id':'1'},{'text':'天气晴朗，适合外出。','vector':index_vector('天气晴朗，适合外出。'),'file_id':'2'}]
    assert retrieve_hybrid(rows,query)[0]['file_id']=='1'

def test_citation_identity_and_exact_evidence():
    sources=[{'id':1,'text':'预算为每人两千元。'}]
    assert check_citations('预算为两千元 [9]。',sources)['status']=='invalid'
    async def bad_audit(*args):return json.dumps({'supported':True,'evidence':[{'citation_id':1,'quote':'预算三千元'}]})
    result=asyncio.run(audit_answer('预算两千元 [1]。',sources,bad_audit))
    assert result['grounding']=='needs_review'
    async def good_audit(*args):return json.dumps({'supported':True,'evidence':[{'citation_id':1,'quote':'每人两千元'}]})
    assert asyncio.run(audit_answer('预算两千元 [1]。',sources,good_audit))['grounding']=='supported'

def cjk_image():
    from PIL import Image,ImageDraw,ImageFont
    options=['C:/Windows/Fonts/msyh.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
    fontpath=next((p for p in options if Path(p).exists()),None)
    if not fontpath:pytest.skip('Chinese font not installed')
    image=Image.new('RGB',(1200,200),'white')
    ImageDraw.Draw(image).text((20,45),'杭州出行预算：每人2000元，周六出发。',font=ImageFont.truetype(fontpath,40),fill='black')
    return image

def test_real_chinese_ocr_and_scanned_pdf(tmp_path,monkeypatch):
    monkeypatch.setenv('INDEX_DIR',str(tmp_path/'index'));monkeypatch.setenv('FILE_DIR',str(tmp_path/'files'))
    (tmp_path/'files').mkdir();sys.modules.pop('app',None);ai=importlib.import_module('app')
    image=cjk_image()
    first='d'*32;second='e'*32
    image.save(tmp_path/'files'/first,format='PNG')
    image.save(tmp_path/'files'/second,format='PDF',resolution=120)
    for id,name in ((first,'截图.png'),(second,'扫描攻略.pdf')):
        result=ai.extract(ai.IndexInput(file_id=id,conversation_id='7',name=name))
        assert result['indexed_chunks']>0
    with ai.database() as db:
        rows=db.execute('SELECT text,embedding FROM chunks').fetchall()
    assert all('2000' in row['text'] and '杭州' in row['text'] for row in rows)
    assert all(len(json.loads(row['embedding'])['semantic'])==384 for row in rows)
