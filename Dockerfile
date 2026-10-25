FROM node:22-slim

# Azure MCP Server (npx) と Claude Code に必要。python3 は猫神さまの委任スクリプト（nekogamisama/bin/delegate.sh）用
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json dashboard/
RUN cd dashboard && npm ci --omit=dev

COPY . .
RUN chown -R node:node /app
USER node

# コンテナ外(Mac)から届くよう全インターフェースで待ち受ける。公開範囲は compose 側で 127.0.0.1 に限定
# ログイン情報・設定を 1 ディレクトリに集約（compose で名前付きボリュームにする）
ENV CLAUDE_CONFIG_DIR=/home/node/.claude-config
RUN mkdir -p /home/node/.claude-config
# Azure MCP（.NET 製）は libicu が無いと起動直後に落ちる。ICU を使わない invariant モードで動かす（MCP の動作に影響しない）
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
ENV TRACE_HOST=0.0.0.0 TRACE_PORT=4317
EXPOSE 4317
WORKDIR /app/dashboard
CMD ["node", "server.mjs"]
