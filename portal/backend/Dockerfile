# ポータルの API（FastAPI）。台帳・定義ファイル・性格・テーマは、compose がマウントするプロジェクトのディレクトリを読み書きする
FROM python:3.12-slim

RUN useradd --create-home --uid 1000 app
WORKDIR /srv/backend
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY portal_api portal_api

USER app
# コンテナ内ではプロジェクトを /project にマウントする。Docker 操作はコンテナからはできないので切る
ENV PROJECT_DIR=/project PORTAL_HOST=0.0.0.0 PORTAL_PORT=4401 PORTAL_DOCKER=0
EXPOSE 4401
CMD ["python", "-m", "portal_api"]
