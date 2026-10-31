"""Deterministic Chinese/English lexical vectors; no model download or secret."""
import hashlib
import math
import re
from collections import Counter


def features(text):
    text = text.lower()
    words = re.findall(r"[a-z0-9_]+|[\u3400-\u9fff]", text)
    chars = "".join(re.findall(r"[\u3400-\u9fff]", text))
    return words + [chars[i:i+2] for i in range(len(chars)-1)]


def vector(text):
    counts = Counter(features(text))
    buckets = Counter()
    for word, count in counts.items():
        index = int.from_bytes(hashlib.blake2b(word.encode(), digest_size=4).digest(), "little") % 8192
        buckets[index] += 1 + math.log(count)
    norm = math.sqrt(sum(v*v for v in buckets.values())) or 1
    return {str(k): v/norm for k, v in buckets.items()}


def cosine(a, b):
    return sum(value*b.get(key, 0) for key, value in a.items())


def chunks(text, size=360, overlap=150):
    text = text.replace("\x00", "").strip()
    result=[]
    for start in range(0,len(text),size-overlap):
        if text[start:start+size].strip():result.append(text[start:start+size])
        if start+size>=len(text):break
    return result


def retrieve(rows, question, limit=6):
    query = vector(question)
    ranked = [(cosine(query, row["vector"]), row) for row in rows]
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [dict(row, score=round(score, 4)) for score, row in ranked[:limit] if score >= 0.08]


def index_vector(text):
    from semantic import embedding
    return {'model':'multilingual-MiniLM-L12-v2-quantized','lexical':vector(text),'semantic':list(embedding(text))}


def retrieve_hybrid(rows,question,limit=6):
    from semantic import embedding,similarity,available
    lexical=vector(question)
    if not available():raise ValueError('语义模型不可用，请先安装模型；没有静默退回关键词检索')
    query=embedding(question);ranked=[]
    for row in rows:
        data=row['vector']
        sparse=data.get('lexical',data)
        dense=data.get('semantic') or embedding(row['text'])
        word_score=cosine(lexical,sparse);semantic_score=similarity(query,dense)
        score=.70*max(0,semantic_score)+.30*word_score
        if (semantic_score>=.42 and score>=.30) or word_score>=.12:
            ranked.append(dict(row,score=round(score,4),lexical_score=round(word_score,4),semantic_score=round(semantic_score,4)))
    ranked.sort(key=lambda row:row['score'],reverse=True)
    return ranked[:limit]
