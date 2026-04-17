'use client';
import { useEffect, useRef, useState } from 'react';
export default function useWebSocket(url: string, token?: string) {
	const [messages, setMessages] = useState<string[]>([]);
	const [parsedMessages, setParsedMessages] = useState<any[]>([]);
	const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error' | 'reconnecting' | 'closed'>('connecting');
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectRef = useRef({ attempts: 0 as number, timer: null as any });

	useEffect(() => {
		let mounted = true;
		const connect = () => {
			if (!mounted) return;
			setConnectionStatus('connecting');
			let wsUrl = url;
			if (token) {
				wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
			}
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;
			ws.onopen = () => {
				reconnectRef.current.attempts = 0;
				setConnectionStatus('connected');
				console.log('[WS] connected', wsUrl);
			};
			ws.onmessage = (ev) => {
				const txt = ev.data;
				setMessages(prev => [...prev, txt]);
				try {
					const p = JSON.parse(txt);
					setParsedMessages(prev => [...prev, p]);
				} catch (e) {
					setParsedMessages(prev => [...prev, txt]);
				}
			};
			ws.onerror = (ev) => {
				console.error('[WS] error', ev);
				setConnectionStatus('error');
			};
			ws.onclose = (ev) => {
				console.warn('[WS] closed', ev.code, ev.reason);
				if (!mounted) return;
				setConnectionStatus('reconnecting');
				const attempts = ++reconnectRef.current.attempts;
				const delay = Math.min(1000 * 2 ** attempts, 30000);
				reconnectRef.current.timer = setTimeout(connect, delay);
			};
		};
		connect();
		return () => {
			mounted = false;
			if (reconnectRef.current.timer) clearTimeout(reconnectRef.current.timer);
			wsRef.current?.close();
			setConnectionStatus('closed');
		};
	}, [url, token]);

	const sendMessage = (msg: any) => {
		const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(str);
		} else {
			console.warn('[WS] not open, message not sent', str);
		}
	};
	return { messages, parsedMessages, sendMessage, connectionStatus };
}
