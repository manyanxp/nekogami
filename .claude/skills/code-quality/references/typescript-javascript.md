# JavaScript / TypeScript 規約

## 基本方針
- 新規コードは原則 TypeScript で書く。既存の JS プロジェクトでは JSDoc で型を付け、`// @ts-check` を検討する。
- フォーマットは Prettier、Lint は ESLint（typescript-eslint）に任せる。
- モジュールは ES Modules（`import` / `export`）を使う。既存が CommonJS ならそれに合わせる。

## 命名
- 変数・関数は `camelCase`、クラス・型・インターフェースは `PascalCase`、定数は `UPPER_SNAKE_CASE`。
- ファイル名はプロジェクトの既存規約（`kebab-case` など）に合わせる。

## 変数・構文
- `var` は使わない。再代入しないものは `const`、するものだけ `let`。
- 比較は `===` / `!==` を使う。
- `null` / `undefined` の扱いは `?.` と `??` を使う（`||` は `0` や `""` も偽になる点に注意）。
- デフォルトエクスポートより名前付きエクスポートを優先する（既存規約があればそれに従う）。

## 型（TypeScript）
- `tsconfig.json` は `"strict": true` を前提にする。加えて `noUncheckedIndexedAccess` を推奨。
- `any` は禁止。型が分からない外部入力は `unknown` で受け、型ガードやスキーマ（zod など）で検証してから使う。
- 型アサーション（`as`）と非nullアサーション（`!`）は最小限にし、使う場合は理由をコメントに書く。
- 状態や結果の種類は判別可能なユニオン型（`{ kind: "ok"; ... } | { kind: "error"; ... }`）で表し、`switch` で網羅性をチェックする（`never` を使う）。
- 固定値の選択肢は `enum` より文字列リテラルのユニオン型（`as const`）を優先する。
- 公開する関数の戻り値には型を明示する。

## 非同期処理
- `async` / `await` を使い、`.then()` のネストを避ける。
- Promise を投げっぱなしにしない（`await` するか、意図的なら `void` を付けて理由をコメント）。ESLint の `no-floating-promises` を有効にする。
- 独立した処理は `Promise.all` で並列化する。部分的な失敗を許すなら `Promise.allSettled`。
- ループ内の逐次 `await` は、順序が必要な場合のみ。

## エラー処理
- `throw` するのは `Error`（またはそのサブクラス）のみ。文字列を投げない。
- `catch (e)` の `e` は `unknown` として扱い、`instanceof Error` で絞り込む。
- エラーを包む場合は `new Error("...", { cause: e })` で原因をつなぐ。

## セキュリティ（フロントエンド含む）
- `innerHTML` / `dangerouslySetInnerHTML` に外部入力を渡さない。必要ならサニタイズ（DOMPurify など）する。
- `eval` / `new Function` / 文字列を渡す `setTimeout` は使わない。
- フロントエンドのコードに秘密情報を含めない（ビルド後に誰でも読める）。
- `console.log` でのデバッグ出力を残さない。

## React を使う場合
- コンポーネントは関数コンポーネントで書き、props に型を付ける。
- Hooks のルール（トップレベルでのみ呼ぶ）を守り、`useEffect` の依存配列を省略・偽装しない（`eslint-plugin-react-hooks` を有効にする）。
- リストの `key` に配列のインデックスを使わない（並び替え・削除がある場合）。

## テスト（Vitest / Jest）
- テストファイルは `*.test.ts`（既存規約があればそれに従う）。
- `describe` で対象をまとめ、`it("〜のとき〜を返す")` のように条件と期待結果を書く。
- 複数パターンは `it.each` / `test.each` を使う。
- 時刻・乱数・外部APIはモックする（`vi.useFakeTimers()` など）。

## 推奨設定（tsconfig.json の例）
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true
  }
}
```
