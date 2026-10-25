import { describe, expect, it } from 'vitest';
import { checkUpload, defaultIcon, entityIconUrl, iconUrl } from './icons';

describe('icons', () => {
  it('既定は種別ごと（猫神さま = sun、ほか = miko）', () => {
    expect(defaultIcon('orchestrator')).toBe('builtin:sun_cat_goddess');
    for (const k of ['suborchestrator', 'agent', 'subagent', undefined]) expect(defaultIcon(k)).toBe('builtin:miko_cat_goddess');
  });
  it('台帳の icon があればそれ、なければ既定の URL', () => {
    expect(entityIconUrl({ kind: 'agent', icon: 'upload:abc.png' })).toBe('/api/icons/upload:abc.png');
    expect(entityIconUrl({ kind: 'orchestrator', icon: null })).toBe(iconUrl('builtin:sun_cat_goddess'));
    expect(entityIconUrl(undefined, 'agent')).toBe(iconUrl('builtin:miko_cat_goddess'));
  });
  it('アップロードの簡易検査', () => {
    expect(checkUpload({ size: 10, type: 'image/png' })).toBe('');
    expect(checkUpload({ size: 600 * 1024, type: 'image/png' })).toMatch('512KB');
    expect(checkUpload({ size: 10, type: 'image/svg+xml' })).toMatch('PNG');
  });
});
