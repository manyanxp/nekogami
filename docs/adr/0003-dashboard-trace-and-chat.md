# 0003. Agent Console（トレース可視化 + チャット）の方式

- 状態: Accepted（Phase 5 で「Azure Sage Console」を「Agent Console」に改称し、複数の相手と話せるようにした: [ADR 0020](0020-agent-console-multi-target.md)）
- 日付: 2026-10-23

## 背景
マルチエージェントの動き（誰が何を呼んだか、所要時間、エラー、拒否）を見ながら対話したい。CLI での利用も同じ画面で追いたい。

## 決定
- `dashboard/server.mjs`（Node.js 18+、依存は Claude Agent SDK）が単一サーバーで以下を提供する。

| エンドポイント | 役割 |
|---|---|
| `POST /hooks` | Claude Code の HTTP フックを受信（CLI・SDK 共通） |
| `GET /events` | ブラウザへ SSE でリアルタイム配信 |
| `POST /api/chat` | Agent SDK で会話を実行（`settingSources: ['project']`） |
| `POST /api/stop` / `POST /api/reset` | 応答の中断 / 新しい会話（応答中のリセットは 409） |
| `GET /api/auth/*`, `POST /api/auth/*` | ブラウザからの Claude ログイン補助 |
| `GET /api/docs`, `GET /api/doc?path=` | 保存済みマークダウンの一覧と本文 |

- サブエージェント名→モデルは `.claude/agents/*.md` の frontmatter から取得して画面に反映。
- ポートは `TRACE_PORT`（既定 4317）。変更時は `.claude/settings.json` のフック URL も更新する。
- フロントは `dashboard/public/index.html` 単一ファイル（ビルド不要）。マークダウン描画は `marked` + `DOMPurify`（`/vendor/`）。
- `scripts/demo-events.mjs` で API キーなしに画面を確認できる。

## 理由・検討した代替案
フックを使うことで CLI とブラウザのトレースを同一実装にできる。フレームワーク（React 等）導入は、単一ファイルで十分なため見送り。

## 影響
- ダッシュボード停止中は CLI のフック送信がエラー表示になる（動作は止まらない）。不要なら `disableAllHooks`。
- 関連: `dashboard/`, `.claude/settings.json`
