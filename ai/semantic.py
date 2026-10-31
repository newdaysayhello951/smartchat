"""Local, quantized multilingual MiniLM embeddings (384 dimensions)."""
from functools import lru_cache
from pathlib import Path
import os
import threading
import numpy as np

MODEL_DIR=Path(os.getenv('SEMANTIC_MODEL_DIR',str(Path(__file__).resolve().parents[1]/'data/models/multilingual-minilm')))
_lock=threading.Lock()
_engine=None


def available():
    return (MODEL_DIR/'model.onnx').is_file() and (MODEL_DIR/'tokenizer.json').is_file()


def engine():
    global _engine
    with _lock:
        if _engine is None:
            import onnxruntime as ort
            from tokenizers import Tokenizer
            if not available():raise ValueError('语义模型尚未安装，请运行 scripts/setup-ai-models.py')
            tokenizer=Tokenizer.from_file(str(MODEL_DIR/'tokenizer.json'))
            pad=tokenizer.token_to_id('<pad>')
            if pad is None:pad=tokenizer.token_to_id('[PAD]') or 0
            tokenizer.enable_truncation(max_length=512)
            tokenizer.enable_padding(pad_id=pad,pad_token='<pad>' if tokenizer.token_to_id('<pad>') is not None else '[PAD]')
            options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
            session=ort.InferenceSession(str(MODEL_DIR/'model.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
            _engine=tokenizer,session
    return _engine


@lru_cache(maxsize=2048)
def embedding(text):
    tokenizer,session=engine()
    encoded=tokenizer.encode_batch([text[:10000]])
    inputs={'input_ids':np.array([x.ids for x in encoded],dtype=np.int64),'attention_mask':np.array([x.attention_mask for x in encoded],dtype=np.int64),'token_type_ids':np.array([x.type_ids for x in encoded],dtype=np.int64)}
    outputs=session.run(None,{item.name:inputs[item.name] for item in session.get_inputs()})
    hidden=outputs[0];mask=inputs['attention_mask'][...,None].astype(np.float32)
    result=(hidden*mask).sum(axis=1)/mask.sum(axis=1).clip(min=1)
    result=result[0];result=result/max(float(np.linalg.norm(result)),1e-12)
    return tuple(float(x) for x in result)


def similarity(a,b):return float(np.dot(a,b))
