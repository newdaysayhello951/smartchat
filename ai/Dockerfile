FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10002 -m app && mkdir -p /data/index && chown app /data/index
COPY . .
USER app
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "64"]
