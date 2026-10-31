"""Local Chinese/English OCR, with bounded image dimensions and serialized engine."""
import threading
import numpy as np
from PIL import Image

_engine=None
_lock=threading.Lock()

def image_text(image):
    global _engine
    if isinstance(image,(str,bytes)):
        image=Image.open(image)
    if image.width*image.height>30_000_000:raise ValueError('图片超过 3000 万像素，请缩小后上传')
    image=image.convert('RGB');image.thumbnail((2400,2400))
    with _lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR
            _engine=RapidOCR()
        result,_=_engine(np.array(image))
    return '\n'.join(str(row[1]) for row in (result or []) if float(row[2])>=.5)

def scanned_pdf_page(path,page_index):
    import pypdfium2 as pdfium
    pdf=pdfium.PdfDocument(str(path))
    try:
        page=pdf[page_index]
        try:
            bitmap=page.render(scale=1.8)
            try:return image_text(bitmap.to_pil())
            finally:bitmap.close()
        finally:page.close()
    finally:pdf.close()
