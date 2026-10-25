"""Python ノードと入力ノード（ADR 0041）の検証。

- Python ノード: 関数のコード。コードは**実行せず** `ast` で読み、引数の名前・型注釈・既定値を取り出す（型注釈は必須）。
- 入力ノード: 引数名・データ型・値。値は型に従って読み、JSON の文字列にして保存する（Agent Console はこれを読む）。
Python 標準のデータ型は PY_TYPES。JSON で運べない tuple / set は、JSON の配列で運び、実行側で型に戻す。
"""
import ast
import json
import math
import re

PY_TYPES = ('str', 'int', 'float', 'bool', 'list', 'dict', 'tuple', 'set')
IDENT_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
MAX_CODE = 20000
MAX_PARAMS = 20
MAX_VALUE = 4000


def _type_name(ann):
    """型注釈 → PY_TYPES の名前。`list[int]` のような添字つきは、外側の型にする。標準の型以外は None"""
    if isinstance(ann, ast.Name) and ann.id in PY_TYPES:
        return ann.id
    if isinstance(ann, ast.Subscript) and isinstance(ann.value, ast.Name) and ann.value.id in ('list', 'dict', 'tuple', 'set'):
        return ann.value.id
    return None


def _jsonable(v):
    """tuple / set は配列にする（set は並びを決める）。JSON にできないものは ValueError"""
    if isinstance(v, (set, frozenset)):
        v = sorted(v, key=repr)
    if isinstance(v, (tuple, list)):
        return [_jsonable(x) for x in v]
    if isinstance(v, dict):
        if not all(isinstance(k, str) for k in v):
            raise ValueError('dict のキーは文字列だけ')
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, float) and not math.isfinite(v):
        raise ValueError('有限の数だけ')
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    raise ValueError('定数（文字列・数・真偽・リスト・辞書など）だけ')


def _matches(type_name, v):
    if v is None:
        return True   # 既定値 None は「渡さなければ None」の意味で、どの型でも許す
    if type_name == 'int':
        return isinstance(v, int) and not isinstance(v, bool)
    if type_name == 'float':
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if type_name == 'bool':
        return isinstance(v, bool)
    if type_name == 'str':
        return isinstance(v, str)
    if type_name == 'dict':
        return isinstance(v, dict)
    return isinstance(v, list)   # list / tuple / set は、配列にした値


def parse_function(code, func):
    """コードから、関数 func の引数を読む。戻り値: {'params': [...], 'doc': 説明の 1 行}。不正なら ValueError（日本語のメッセージ）"""
    if not isinstance(code, str) or not code.strip():
        raise ValueError('コードが空')
    if len(code) > MAX_CODE:
        raise ValueError(f'コードは {MAX_CODE} 文字まで')
    if not isinstance(func, str) or not IDENT_RE.match(func):
        raise ValueError('関数名は、英数字と _ からなる Python の名前')
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f'構文エラー（{e.lineno} 行目）: {e.msg}') from None
    fns = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == func]
    if not fns:
        raise ValueError(f'関数 {func} が、コードの先頭の階層に定義されていない（def {func}(...):）')
    fn = fns[-1]
    if isinstance(fn, ast.AsyncFunctionDef):
        raise ValueError('async の関数は使えない')
    a = fn.args
    if a.vararg or a.kwarg or a.posonlyargs:
        raise ValueError('*args・**kwargs・位置専用の引数は使えない（名前で渡せる引数だけ）')
    n_pos, n_def = len(a.args), len(a.defaults)
    items = [(arg, a.defaults[i - (n_pos - n_def)] if i >= n_pos - n_def else None) for i, arg in enumerate(a.args)]
    items += list(zip(a.kwonlyargs, a.kw_defaults))
    if len(items) > MAX_PARAMS:
        raise ValueError(f'引数は {MAX_PARAMS} 個まで')
    params = []
    for arg, d in items:
        tname = _type_name(arg.annotation) if arg.annotation is not None else None
        if tname is None:
            raise ValueError(f'引数 {arg.arg} に、標準の型の注釈が要る（{", ".join(PY_TYPES)}。例: {arg.arg}: int）')
        p = {'name': arg.arg, 'type': tname, 'required': d is None, 'default': None}
        if d is not None:
            try:
                p['default'] = _jsonable(ast.literal_eval(d))
            except (ValueError, SyntaxError, TypeError, MemoryError) as e:
                raise ValueError(f'引数 {arg.arg} の既定値は定数だけ: {e}') from None
            if not _matches(tname, p['default']):
                raise ValueError(f'引数 {arg.arg} の既定値が、型 {tname} と合わない')
        params.append(p)
    doc = (ast.get_docstring(fn) or '').strip().split('\n')[0][:200]
    return {'params': params, 'doc': doc}


def parse_input(dtype, value):
    """入力ノードの値を、データ型に従って読む。戻り値は JSON にできる値（tuple / set は配列）。不正なら ValueError"""
    if dtype not in PY_TYPES:
        raise ValueError(f'データ型は {", ".join(PY_TYPES)} のいずれか')
    text = '' if value is None else value
    if not isinstance(text, str) or len(text) > MAX_VALUE:
        raise ValueError(f'値は文字列で、{MAX_VALUE} 文字まで')
    if dtype == 'str':
        return text
    t = text.strip()
    try:
        if dtype == 'int':
            if not re.fullmatch(r'[+-]?\d+', t):
                raise ValueError('整数で書く（例: 42）')
            return int(t)
        if dtype == 'float':
            v = float(t)
            if not math.isfinite(v):
                raise ValueError('有限の数で書く')
            return v
        if dtype == 'bool':
            if t.lower() not in ('true', 'false'):
                raise ValueError('true か false で書く')
            return t.lower() == 'true'
        v = json.loads(t)   # list / dict / tuple / set は JSON で書く（tuple・set も配列）
    except (ValueError, json.JSONDecodeError) as e:
        raise ValueError(f'{dtype} の値として読めない: {e}') from None
    if dtype == 'dict':
        if not isinstance(v, dict):
            raise ValueError('dict は JSON のオブジェクトで書く（例: {"a": 1}）')
        return _jsonable(v)
    if not isinstance(v, list):
        raise ValueError(f'{dtype} は JSON の配列で書く（例: [1, 2, 3]）')
    return _jsonable(v)


def binding_errors(params, inputs):
    """Python ノードの引数 params に、入力ノード inputs（台帳の項目のリスト）をつないでよいか。問題の一覧（空なら良い）"""
    by_name = {p['name']: p for p in params}
    errors, seen = [], {}
    for i in inputs:
        p = by_name.get(i.get('param'))
        if p is None:
            errors.append(f'入力ノード {i["name"]} の引数名 {i.get("param")} は、関数の引数にない')
        elif p['type'] != i.get('dtype'):
            errors.append(f'入力ノード {i["name"]} の型 {i.get("dtype")} が、引数 {p["name"]} の型 {p["type"]} と合わない')
        if i.get('param') in seen:
            errors.append(f'引数 {i.get("param")} に、入力ノードが 2 つつながっている: {seen[i["param"]]}, {i["name"]}')
        seen[i.get('param')] = i['name']
    return errors
