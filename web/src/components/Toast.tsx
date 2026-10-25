'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

type Notify = (msg: string, err?: boolean) => void;
const Ctx = createContext<Notify>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback<Notify>((msg, err = false) => {
    setT({ msg, err }); clearTimeout(timer.current); timer.current = setTimeout(() => setT(null), 3500);
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      <div id="toast" role="status" className={t ? `show${t.err ? ' err' : ''}` : ''}>{t?.msg}</div>
    </Ctx.Provider>
  );
}
