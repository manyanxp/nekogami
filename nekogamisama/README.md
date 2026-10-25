# 猫神さま（NekoGamiSama）

全体を束ねる最上位オーケストレーターです。サブオーケストレーター（現在は Azure Sage）に依頼を委任し、結果を統合して答えます。設計は [ADR 0011](../docs/adr/0011-nekogamisama-hierarchy-and-delegation.md)。

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | 猫神さまの役割・委任のしかた・守ること |
| `suborchestrators.json` | 委任先の一覧（名前 → フォルダ）。ここにない名前へは委任できない |
| `bin/delegate.sh` | 委任スクリプト。フォルダに移って `claude -p` を別セッションで実行 |
| `.claude/settings.json` | 権限（Read 系と `delegate.sh` のみ）と Agent Console へのフック |

## 使い方

```bash
# A. ブラウザ（Agent Console）で猫神さまと話す
cd dashboard && CHAT_PROJECT_DIR=nekogamisama npm start    # → http://127.0.0.1:4317

# B. ポータル（http://127.0.0.1:4400）の右のチャット欄。Agent Console（上の npm start）を起動しておく

# C. CLI で話す
cd nekogamisama && claude
```

チャットボット `neko-chat`（猫神さま直下のエージェント。雑談・使い方の説明）と、チャットの `/名前 依頼文` による指名は [ADR 0026](../docs/adr/0026-chatbot-agent-and-slash-commands.md)。

性格（一人称・口調など）は、管理ページの「猫神さまの性格」で設定します（[ADR 0021](../docs/adr/0021-nekogamisama-personality.md)）。

トレースのエージェント発言には語尾「にゃ」が付きます（[ADR 0012](../docs/adr/0012-trace-nya-suffix.md)）。

## サブオーケストレーターを増やす

- **ポータルのノードグラフで追加する（推奨）**: 「猫神さま管理」の「＋ サブオーケストレーター」。`.claude/agents/<名前>/<名前>.md` が作られ、`suborchestrators.json` に `type: agent` で登録される。猫神さまは Agent ツールで呼ぶ（[ADR 0017](../docs/adr/0017-suborchestrator-as-agent-definition.md)）。
- **別セッション型（`type: session`）**: 担当フォルダに `CLAUDE.md` と `.claude/` を用意し、`suborchestrators.json` に `"名前": { "type": "session", "dir": "<このフォルダからの相対パス>", "description": "…" }` を手で足す。`delegate.sh` で委任される。

CLI で使うときは、一度 `cd nekogamisama && claude` を対話で起動し、フォルダの信頼の確認に答えてください（答えないと `claude -p` では `permissions.allow` が無視されます）。

## 動作確認

`bin/delegate.sh` の入出力・名前の検証は偽の `claude` で確認済みです。実際に Claude へ委任する動作は、認証した環境で次を実行して確認してください。

```bash
nekogamisama/bin/delegate.sh <session 型の名前> '依頼文'    # 現在、session 型の登録はない。agent 型は猫神さまが Agent ツールで呼ぶ
```
