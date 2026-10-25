// アイコンの参照（`builtin:<名前>` / `upload:<ID>`。null は種別ごとの既定）。portal_api/icons.py と同じ規則（ADR 0032）
import type { Kind } from './types';

export interface IconList { builtin: string[]; uploads: string[]; defaults: { orchestrator: string; other: string } }

export const MAX_UPLOAD = 512 * 1024;
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export const defaultIcon = (kind?: Kind | string): string => (kind === 'orchestrator' ? 'builtin:sun_cat_goddess' : 'builtin:miko_cat_goddess');
export const iconUrl = (ref: string): string => `/api/icons/${ref}`;
/** 台帳の icon（なければ種別の既定）の画像の URL */
export const entityIconUrl = (e: { kind?: Kind | string; icon?: string | null } | undefined, kind?: string): string => iconUrl(e?.icon || defaultIcon(e?.kind || kind));
/** アップロードの前の簡易検査（本検査はサーバー）。問題があれば理由を返す */
export const checkUpload = (f: { size: number; type: string }): string => (f.size > MAX_UPLOAD ? `画像は ${MAX_UPLOAD / 1024}KB まで` : !ACCEPT.split(',').includes(f.type) ? 'PNG / JPEG / WebP / GIF のみ' : '');
