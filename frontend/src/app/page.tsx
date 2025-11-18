import { redirect } from 'next/navigation';

export default function Home() {
  // Redirect to login if not authenticated (client-side check)
  redirect('/login');
}

//export default function Home(){ return (<main><h1 className='text-4xl font-bold'>AgentFinance</h1><p className='mt-4 text-gray-300'>Realtime agent orchestration platform.</p></main>); }