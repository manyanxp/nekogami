import '@/styles/console.css';
import { Gate } from '@/components/Gate';
import ConsoleApp from '@/components/ConsoleApp';

export const metadata = { title: 'Agent Console' };
export default function Page() { return <Gate role="admin"><ConsoleApp /></Gate>; }
