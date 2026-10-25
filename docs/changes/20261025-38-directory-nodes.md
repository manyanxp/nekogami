# 2026-10-25 ディレクトリのノードと権限（rev1 の第 2 段階）

- 関連 ADR: 0037
- 関連要件: [rev1](../requirements/20261025-rev1-ui-and-agent-tools.md)（B3）
- 影響範囲: `portal/backend/portal_api/{registry,definitions}.py`、`dashboard/{server,fs-tools}.mjs`、`web/src/`（管理ページ）、`docker-compose.yml`、`workspace/`

## 変更前
担当が読み書きできるのは、定義ファイルの `Read` / `Write` などの組み込みツールが許す範囲だけだった。ディレクトリを個別に割り当てる仕組みはなかった。

## 変更後
- ツールの種類に `directory` を追加。場所（`workspace/` からの相対）と、参照・読み込み・書き込み・削除の権限（既定オフ）を持つ。
- ノードを担当につなぐと、定義ファイルの `tools` に `mcp__dir-<名前>__*` が入り、権限がオンの操作だけが、その担当のツールになる。
- 書き込み・削除つきのノードを新しくつなぐときは確認が要る。
- `canUseTool` が、権限と、呼んだ担当の接続を確かめる。シンボリックリンクなどでの外への脱出は拒否する。
- 検証: API 51 件、Console 31 件、画面 43 件が成功。実際の Claude で、書き込み・一覧・読み込みと、権限のない削除が公開されないことを確認した。

## 移行・注意点
- `docker compose up -d --build`。ホストに `workspace/` ができる（Git の管理対象外）。
- 依存に `zod`（MIT）を追加。`docs/licenses/third-party-npm.md` を更新した。
- 猫神さま自身と、別セッション型の委任先は対象外（ADR 0037）。
