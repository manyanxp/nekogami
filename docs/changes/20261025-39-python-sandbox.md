# 2026-10-25 Python の生成・実行（rev1 の第 3 段階）

- 関連 ADR: 0038（0037 の権限に `exec` を追加）
- 関連要件: [rev1](../requirements/20261025-rev1-ui-and-agent-tools.md)（B2）
- 影響範囲: `sandbox/`（新規）、`docker-compose.yml`、`dashboard/{py-exec,fs-tools,server}.mjs`、`portal/backend/portal_api/registry.py`、`web/src/`（管理ページ）、`.claude/agents/nekogamisama/py-analyst.md`

## 変更前
担当がコードを実行する手段は、`Bash` の追加（危険ツールの確認つき）しかなかった。作業場所を絞る仕組みはなかった。

## 変更後
- ディレクトリのノードに、権限「Python 実行」を追加。
- 実行役のコンテナ `py-sandbox`（ネットワークなし・読み取り専用・非 root・メモリ/プロセス上限）を追加。numpy・pandas・scipy・matplotlib・scikit-learn・openpyxl が使える。
- ノードの中身のコピーで実行し、読み込み・書き込み・削除の権限の範囲だけを、ノードへ戻す。30 秒・出力 100 KB の上限。
- 担当 `py-analyst` を追加（猫神さまの直下）。管理ページで、Python 実行を許したディレクトリのノードをつなぐと使える。
- ディレクトリのノードを消すと、担当の定義ファイルの接続も外す（同名ノードの作り直しで勝手につながるのを防ぐ）。
- 検証: API 51 件、Console 37 件、画面 43 件が成功。実機で、制限の動作と、実際の Claude による分析（集計・グラフ）を確認した。

## 移行・注意点
- `docker compose up -d --build`。`py-sandbox` が増え、ホストに `sandbox/jobs/`（Git の管理対象外）ができる。初回はライブラリの取得で時間がかかる。
- すでに作ってあるディレクトリのノードの権限は変わらない（`exec` はオフ）。
- ライセンス台帳に、実行役の Python ライブラリを追加した（すべて BSD・MIT 系）。
