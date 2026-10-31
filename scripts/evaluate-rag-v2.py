"""Labeled evaluation over actual project documents; optional paid-model checks."""
import argparse
import asyncio
import importlib
import json
import os
from pathlib import Path
import sys
import hashlib

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--with-llm',action='store_true');args=p.parse_args()
work=root/'data/rag-v2-evaluation';(work/'files').mkdir(parents=True,exist_ok=True)
os.environ.update(INDEX_DIR=str(work/'index'),FILE_DIR=str(work/'files'),PROJECT_ENV_FILE=str(root/'.env'))
sys.path.insert(0,str(root/'ai'))
from retrieval import retrieve_hybrid
ai=importlib.import_module('app')
sources=['docs/upgrade-v2.md','docs/deepseek.md','docs/sharing.md']
for source in sources:
    content=(root/source).read_bytes();id=hashlib.md5(source.encode()).hexdigest();(work/'files'/id).write_bytes(content)
    result=ai.extract(ai.IndexInput(file_id=id,conversation_id='999',name=Path(source).name))
    print('Indexed project document:',source,result['indexed_chunks'],flush=True)
with ai.database() as db:records=db.execute("SELECT * FROM chunks WHERE conversation_id='999'").fetchall()
rows=[dict(row,vector=json.loads(row['embedding'])) for row in records]
cases=[
 ('第一次私聊前，对方必须先做什么？','需要对方同意好友申请'),
 ('发起申请的人能不能自己批准加好友？','只有申请接收方'),
 ('群主不想留在群里，退出前要怎么处理？','先转让再退出'),
 ('一个聊天群可以容纳多少个人？','最多 50 人'),
 ('被踢出群以后还可以读取群里的附件吗？','立即失去'),
 ('发错的消息在多久之内允许收回？','两分钟'),
 ('换了密码之后其他手机上的登录还有效吗？','旧设备令牌全部失效'),
 ('新上传方式能发送多大的文件？','最大 1 GB'),
 ('上传时每一块文件的体积是多少？','4 MB'),
 ('传输过程中用什么算法检查内容有没有损坏？','SHA-256'),
 ('浏览器页面刷新了，怎样继续没有发完的附件？','重新选择同一文件'),
 ('旧的单次请求接口是否仍有限制？','50 MB'),
 ('下载一个大附件会一次性占用服务器一整个文件的内存吗？','小缓冲区'),
 ('现在的语义向量有多少个维度？','384 维'),
 ('图片里的汉字通过什么软件识别？','RapidOCR'),
 ('全是扫描图像的 PDF 最多能识别多少页？','扫描 PDF 最多 40 页'),
 ('一张图片的像素数量限制是多少？','3000 万像素'),
 ('引用核验怎样确认模型给出的证据真的来自资料？','逐字片段'),
 ('当前已经有公网音视频中转服务了吗？','没有 TURN 服务'),
 ('API 用哪个标准名称调用 V4.1 Flash？','deepseek-flash'),
 ('模型密钥应该放在哪里读取？','密钥仅由 Python 后端读取'),
 ('哪一个文件能关掉对外分享、但保留本机聊天？','Stop-Sharing.cmd'),
 ('九寨沟今天的门票现价是多少？',None),
 ('查一下北京明天具体几点下雨。',None),
 ('这个月哪支股票会涨停？',None),
 ('2027 年世界杯冠军是谁？',None),
]
results=[]
for question,gold in cases:
    hits=retrieve_hybrid(rows,question)
    results.append({'question':question,'gold_evidence':gold,'hit_at_1':bool(hits and gold in hits[0]['text']) if gold else not hits,'hit_at_6':any(gold in h['text'] for h in hits) if gold else not hits,'top_sources':[{'name':h['name'],'chunk':h['ordinal']+1,'score':h['score']} for h in hits]})
positive=[r for r in results if r['gold_evidence']];negative=[r for r in results if not r['gold_evidence']]
report={'dataset':'26 labeled paraphrases over real project documents; 22 answerable, 4 absent','sources':sources,'model':'local multilingual MiniLM 384d + lexical','recall_at_1':round(sum(r['hit_at_1'] for r in positive)/len(positive),4),'recall_at_6':round(sum(r['hit_at_6'] for r in positive)/len(positive),4),'negative_rejection_rate':round(sum(r['hit_at_6'] for r in negative)/len(negative),4),'results':results}
if args.with_llm:
    async def answers():
        output=[]
        for index in (0,9,15,19,22):
            question=cases[index][0]
            response=await ai.answer(ai.JobInput(conversation_id='999',mode='ask',question=question))
            output.append({'question':question,'answer':response['answer'],'citation_check':response.get('citation_check'),'sources':[{'id':c['id'],'name':c['name'],'text':c['text']} for c in response['citations']]})
            print('Real-model answer evaluated:',index,flush=True)
        return output
    report['real_model_answers']=asyncio.run(answers())
target=root/'docs/rag-v2-evaluation.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ('results','real_model_answers')},ensure_ascii=False,indent=2),flush=True)
