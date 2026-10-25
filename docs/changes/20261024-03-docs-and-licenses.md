# 2026-10-24 docs/ への集約とライセンス台帳

- 関連 ADR: なし（ドキュメント構成の整理）
- 影響範囲: ドキュメント、`scripts/`

## 変更前
`adr/` と `changes/` がプロジェクト直下にあった。ライセンスの記録はなかった。

## 変更後
`docs/` 配下に `adr/`・`changes/`・`licenses/` を集約。

## 差分
- 変更: `adr/` → `docs/adr/`、`changes/` → `docs/changes/`（相互リンクは相対パスのため維持）。
- 追加: `docs/README.md`、`docs/licenses/README.md`（ライセンス台帳）、`docs/licenses/third-party-npm.md`（自動生成）、`scripts/gen-licenses.py`。

## 注意点
- 本体のライセンスは未設定（台帳に「要決定」と記載）。
