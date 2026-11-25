# Whasalia voice service (Pipecat): WhatsApp calls answered by an AI agent.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
RUN useradd --create-home whasalia
USER whasalia

CMD ["python", "app.py"]
