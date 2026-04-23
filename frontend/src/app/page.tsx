// import { redirect } from 'next/navigation';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

//  export default function Home() {
//    // Redirect to login if not authenticated (client-side check)
//    redirect('/login');
// }
// @ts-ignore - TypeScript may show error in IDE but works at runtime

//export default function Home(){ return (<main><h1 className='text-4xl font-bold'>AgentFinance</h1><p className='mt-4 text-gray-300'>Realtime agent orchestration platform.</p></main>); }

export default async function Page() {
  const cookieStore = await cookies();

  // Adjust this name to match your auth token
  const token = cookieStore.get('token');

  if (token) {
    redirect('/dashboard');
  } 
   redirect('/login'); 
}