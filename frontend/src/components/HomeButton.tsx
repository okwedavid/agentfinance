'use client';
import { useRouter } from 'next/navigation';
import { Home } from 'lucide-react';
import Link from "next/link";
export default function HomeButton() {
	return (
		<div className="fixed top-4 left-4 z-50 flex flex-col gap-2">
			<Link href="/" className="flex items-center gap-2 bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-700 shadow">
				<Home className="w-4 h-4" />
				<span className="hidden sm:inline">Home</span>
			</Link>
			<Link href="/dashboard" className="flex items-center gap-2 bg-emerald-700 text-white px-3 py-2 rounded-lg hover:bg-emerald-600 shadow">
				<span className="hidden sm:inline">Analytics</span>
			</Link>
		</div>
	);
}
