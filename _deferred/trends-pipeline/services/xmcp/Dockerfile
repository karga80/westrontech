FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/xdevplatform/xmcp.git .

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8001

ENV MCP_PORT=8001

CMD ["python", "server.py"]
