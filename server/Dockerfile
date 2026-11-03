# Kartenerkennung (#19): DINOv2 + Nummernprüfung, nur CPU
FROM python:3.12-slim
# rapidocr bringt opencv-python mit, das libGL braucht
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY scanner scanner
ENV DATA_DIR=/data HF_HOME=/data/hf PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "scanner.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
