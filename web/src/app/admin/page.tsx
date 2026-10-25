import '@/styles/portal.css';
import { Gate } from '@/components/Gate';
import AdminApp from '@/components/AdminApp';

export const metadata = { title: '猫神さま管理' };
export default function Page() { return <Gate role="admin"><AdminApp /></Gate>; }
