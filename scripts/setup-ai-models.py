"""Install public ONNX weights locally; no model API keys or user data."""
import hashlib
import json
from pathlib import Path
import urllib.request

root=Path(__file__).resolve().parents[1]
target=root/'data/models/multilingual-minilm';target.mkdir(parents=True,exist_ok=True)
sources={'model.onnx':'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_quantized.onnx','tokenizer.json':'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json'}
report={}
for name,url in sources.items():
    file=target/name
    if not file.exists():
        temp=target/(name+'.download')
        with urllib.request.urlopen(url,timeout=60) as response,temp.open('wb') as out:
            while data:=response.read(1024*1024):out.write(data)
        temp.replace(file)
    digest=hashlib.file_digest(file.open('rb'),'sha256').hexdigest()
    report[name]={'url':url,'size':file.stat().st_size,'sha256':digest}
(target/'manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('Local multilingual MiniLM model ready; model hashes saved to manifest.json.')
