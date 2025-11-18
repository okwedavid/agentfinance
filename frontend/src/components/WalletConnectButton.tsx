'use client';
import { useEffect, useState } from 'react';

export default function WalletConnectButton(){
	const [addr, setAddr] = useState<string | null>(null);
	useEffect(()=>{
		// hydrate from localStorage (persisted address)
		const s = localStorage.getItem('agentfi_wallet'); if(s) setAddr(s);
		// if MetaMask already connected, read selected address
		if((window as any).ethereum && (window as any).ethereum.selectedAddress){ setAddr((window as any).ethereum.selectedAddress); }
	},[]);

	const connect = async ()=>{
		try{
			const eth = (window as any).ethereum;
			if(!eth){
				// prompt install
				window.open('https://metamask.io/download.html','_blank');
				return;
			}
			const accounts = await eth.request({ method: 'eth_requestAccounts' });
			const a = accounts && accounts[0];
			if(a){
				localStorage.setItem('agentfi_wallet', a);
				setAddr(a);
			}
		}catch(err){ console.error('wallet connect', err); }
	};

	const disconnect = ()=>{ localStorage.removeItem('agentfi_wallet'); setAddr(null); };

	return addr ? (
		<div className="flex items-center gap-2">
			<div className="bg-gray-800 px-3 py-1 rounded">{addr.slice(0,6)}...{addr.slice(-4)}</div>
			<button onClick={disconnect} className="px-2 py-1 bg-red-600 rounded">Disconnect</button>
		</div>
	) : (
		<button onClick={connect} className="px-3 py-1 bg-indigo-600 rounded">Connect Wallet</button>
	);
}
