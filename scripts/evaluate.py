"""Reproducible lexical retrieval baseline; no LLM calls."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"ai"))
from retrieval import vector, retrieve

documents = {
 "budget":"杭州旅行预算：每人两千元，其中住宿八百元、交通四百元，其余用于餐饮和门票。",
 "time":"出行时间确定为十一月三日，周六早上八点在学校南门集合，星期日晚上返回。",
 "hotel":"住宿选择西湖附近的青竹酒店，预订双床房；由小李负责订酒店。",
 "traffic":"杭州交通方案：乘坐高铁到杭州东站，市内以地铁为主，避免租车。",
 "food":"餐饮偏好：小王不吃辣，小张对花生过敏，优先选择清淡菜品。",
 "weather":"下雨备用方案：取消户外骑行，改为参观浙江省博物馆。",
 "network":"C++ 服务采用八个工作线程，任务队列上限为一百二十八，连接上限五百一十二。",
 "file":"文件大小限制为十兆字节，支持文字 PDF、TXT、Markdown 和图片。",
 "payment":"旅行费用由小陈先行垫付，结束后按照实际支出平均分摊。",
 "privacy":"用户只能下载自己所属会话的文件，资料索引使用会话标识隔离。",
}
questions = [
 ("杭州旅行预算多少","budget"),("住宿预算多少元","budget"),("交通预算多少元","budget"),
 ("出行时间是什么时候","time"),("周六几点集合","time"),("集合地点在哪里","time"),
 ("住宿选择哪家酒店","hotel"),("谁负责订酒店","hotel"),("酒店预订什么房型","hotel"),
 ("杭州交通方案","traffic"),("高铁到哪个站","traffic"),("市内交通怎么安排","traffic"),
 ("谁不吃辣","food"),("谁对花生过敏","food"),("餐饮偏好有哪些","food"),
 ("下雨备用方案","weather"),("下雨参观什么博物馆","weather"),
 ("工作线程有多少","network"),("任务队列上限","network"),("连接上限多少","network"),
 ("文件大小限制","file"),("支持哪些文件类型","file"),
 ("旅行费用谁先垫付","payment"),("费用如何分摊","payment"),
 ("谁能下载会话文件","privacy"),("资料索引怎么隔离","privacy"),
 ("quantum orbital mechanics",None),("意大利签证护照有效期",None),
 ("GPU显存规格",None),("股票分红收益率",None),
]
rows=[{"id":key,"text":text,"vector":vector(text)} for key,text in documents.items()]
results=[]
for question,expected in questions:
    hits=retrieve(rows,question)
    results.append({"question":question,"expected":expected,"top_ids":[hit["id"] for hit in hits],
                    "hit_at_1":bool(hits and hits[0]["id"]==expected) if expected else not hits,
                    "hit_at_6":any(hit["id"]==expected for hit in hits) if expected else not hits})
positive=[r for r in results if r["expected"]]
negative=[r for r in results if not r["expected"]]
report={"type":"lexical retrieval only; not answer quality","questions":len(results),
        "positive_recall_at_1":round(sum(r["hit_at_1"] for r in positive)/len(positive),4),
        "positive_recall_at_6":round(sum(r["hit_at_6"] for r in positive)/len(positive),4),
        "negative_rejection_rate":round(sum(r["hit_at_6"] for r in negative)/len(negative),4),"results":results}
output=Path(__file__).resolve().parents[1]/"docs"/"retrieval-baseline.json"
output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({k:v for k,v in report.items() if k!="results"},ensure_ascii=False,indent=2))
