'use client';
import ApiHeartbeat from './ApiHeartbeat';
import ThemeToggle from './ThemeToggle';
import WalletConnectButton from './WalletConnectButton';
import CreateTaskButton from './CreateTaskButton';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
	const pathname = usePathname();
	return (
		<header className="w-full bg-gray-900 p-4 sticky top-0 z-40 flex justify-end gap-4 items-center">
			<ApiHeartbeat />
			<ThemeToggle />
			<CreateTaskButton />
			<WalletConnectButton />
			<Link href="/dashboard" className={`px-3 py-2 rounded-lg font-semibold transition-colors ${pathname === '/dashboard' ? 'bg-emerald-600 text-white shadow' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}>Analytics Dashboard</Link>
		</header>
	);
}
