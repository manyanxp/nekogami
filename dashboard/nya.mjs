// トレースに出すエージェントの発言の語尾に「にゃ」を付ける（要件 Phase 2）。
// 文末の句読点・空白・省略表示（…(+N chars)）の手前に差し込む。すでに付いていれば何もしない（冪等）。
const TRUNC = /\n…\(\+\d+ chars\)$/;
const TAIL = /[。．.!！?？…~〜\s]*$/;

export function nyaify(text, suffix = 'にゃ') {
  if (typeof text !== 'string' || !suffix) return text;
  const trunc = text.match(TRUNC)?.[0] ?? '';
  const body = trunc ? text.slice(0, -trunc.length) : text;
  const tail = body.match(TAIL)[0];
  const core = body.slice(0, body.length - tail.length);
  if (!core) return text;                      // 空・記号だけの発言には付けない
  if (core.endsWith(suffix)) return text;
  if (core.endsWith('`')) return `${body.trimEnd()}\n${suffix}${trunc}`; // コードブロックで終わる場合は壊さず次の行へ
  return `${core}${suffix}${tail}${trunc}`;
}
