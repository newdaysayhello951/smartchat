import importlib
from pathlib import Path
import sys
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ai'))
def test_docx_text_index(tmp_path,monkeypatch):
    monkeypatch.setenv('INDEX_DIR',str(tmp_path/'index'))
    monkeypatch.setenv('FILE_DIR',str(tmp_path/'files'))
    (tmp_path/'files').mkdir()
    file_id='c'*32
    with zipfile.ZipFile(tmp_path/'files'/file_id,'w') as z:
        z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>杭州预算每人两千元</w:t></w:r></w:p></w:body></w:document>')
    sys.modules.pop('app',None)
    ai=importlib.import_module('app')
    result=ai.extract(ai.IndexInput(file_id=file_id,conversation_id='1',name='guide.docx'))
    assert result['indexed_chunks']==1
    with ai.database() as db:
        assert '杭州预算' in db.execute('SELECT text FROM chunks').fetchone()['text']
