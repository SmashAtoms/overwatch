FROM python:3.12-slim

WORKDIR /app

COPY services/nlp ./services/nlp

RUN pip install --no-cache-dir -e ./services/nlp

WORKDIR /app/services/nlp

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
