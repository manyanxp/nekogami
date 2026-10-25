/** UI のアイコン（public/ui-icons/*.svg。Cat Symbols。このアプリ専用の素材: NOTICE.md）。装飾なので、名前は隣の文字が担う */
export type IconName =
  | 'add' | 'edit' | 'delete' | 'save' | 'refresh' | 'run' | 'stop' | 'download' | 'search' | 'back' | 'expand' | 'forward' | 'menu'
  | 'user' | 'group' | 'settings' | 'logout' | 'lock' | 'auth_key' | 'agent' | 'tool' | 'code_run' | 'folder' | 'list' | 'chat' | 'processing' | 'info';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="ico" src={`/ui-icons/${name}.svg`} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
