# 2026-10-24 チャットの「作業中…」が消えないときの自己修復

- 関連 ADR: 0015、0033
- 影響範囲: 画面（ポータルのチャット）、ポータル API、Agent Console

## 変更前
「作業中…」の GIF は、SSE の `idle` イベントだけで消えていた。`idle` を受け損ねると（実際に、並列実行のあとで最終回答が出ても消えなかった）、再読み込みするまで残った。

## 変更後
応答中の間、画面が 4 秒おきに `GET /api/chat/status` でサーバーの実際の状態を照合し、応答中でなければ「作業中…」を消す。

## 差分（箇条書き）
- 追加: ポータル API `GET /api/chat/status`（`{running: bool}`）。テスト 1 件
- 変更: Agent Console `GET /api/targets` に `running`（応答中の相手の名前の一覧）を追加（既存の項目は変えない）
- 変更: `web/src/components/Chat.tsx`、`web/src/lib/api.ts`

## 移行・注意点
- Agent Console のイメージを作り直す（`docker compose up -d --build`）。古い Console では `running` が無く、照合は「応答中ではない」扱いになる。
- `idle` を受け損ねた根本原因は特定できていない（単純な依頼では `idle` は届く）。照合は、原因によらず回復するための安全策。
