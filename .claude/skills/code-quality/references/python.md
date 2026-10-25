# Python 規約

## スタイル
- PEP 8 に準拠。フォーマットは `ruff format`（または Black）に任せ、手で整形しない。
- import は「標準ライブラリ → サードパーティ → 自プロジェクト」の順。ワイルドカード import（`from x import *`）は禁止。
- 命名: 変数・関数は `snake_case`、クラスは `PascalCase`、定数は `UPPER_SNAKE_CASE`、非公開は先頭 `_`。

## 型ヒント
- すべての関数の引数・戻り値に型を付ける。
- 組み込みのジェネリクスと `|` を使う: `list[str]`, `dict[str, int]`, `str | None`（プロジェクトのPythonバージョンが対応している場合）。
- 構造化データは `dataclass`（必要なら `frozen=True`）、外部入力の検証には Pydantic などを使い、生の `dict` を引き回さない。
- 固定値の選択肢は `Enum` または `Literal` にする。

## よくある落とし穴
- デフォルト引数に可変オブジェクトを使わない（`def f(items: list[str] = [])` は禁止 → `None` にして中で生成）。
- `except Exception:` での包括捕捉は境界のみ。素の `except:` は禁止。
- 例外を変換する場合は `raise NewError(...) from e` で原因をつなぐ。
- ファイル・接続は `with` 文で扱う。
- パス操作は `pathlib.Path` を使う。
- 文字列整形は f-string を使う。ただしロギングは `logger.info("user=%s", user_id)` 形式（遅延評価）。
- `print` でデバッグ出力を残さない。`logging` を使う。
- `subprocess` では `shell=True` を使わず、引数はリストで渡す。
- `pickle` / `yaml.load` を信頼できないデータに使わない（`yaml.safe_load` を使う）。

## 非同期
- `async` 関数内でブロッキングI/O（`requests`, `time.sleep` など）を呼ばない。

## テスト（pytest）
- テストファイルは `test_*.py`、関数は `test_<対象>_<条件>_<期待結果>` の形を目安にする。
- 複数パターンは `@pytest.mark.parametrize` を使う。
- 共通の準備は fixture にまとめる。
- 例外の検証は `pytest.raises(具体的な例外, match=...)`。

## 推奨設定（pyproject.toml の例）
```toml
[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "W", "I", "B", "UP", "N", "S", "SIM", "RUF"]

[tool.mypy]
strict = true
```
