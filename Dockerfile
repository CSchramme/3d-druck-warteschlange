FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN useradd --system --uid 1000 druck && mkdir /data && chown druck /data
USER druck
VOLUME /data
EXPOSE 8000

# Ein Worker (mit Threads), damit der Discord-Abgleich nie doppelt sendet.
CMD ["gunicorn", "--workers", "1", "--threads", "4", "--bind", "0.0.0.0:8000", \
     "--access-logfile", "-", "app:create_app()"]
