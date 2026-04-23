"use client";
import { useEffect, useRef, useState } from "react";
import { WS_BASE, getToken } from "@/lib/api";

export type WsStatus = "live" | "connecting" | "offline";

export interface WsEvent {
  type: string;
  [key: string]: any;
}

interface UseWebSocketOptions {
  onEvent?: (evt: WsEvent) => void;
}

export function useWebSocket({ onEvent }: UseWebSocketOptions = {}) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [parsedMessages, setParsedMessages] = useState<WsEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    const connect = () => {
      if (!mounted.current) return;
      const token = getToken();
      if (!token) {
        setStatus("offline");
        return;
      }

      setStatus("connecting");

      try {
        const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (mounted.current) setStatus("live");
        };

        ws.onmessage = (event) => {
          if (!mounted.current) return;
          try {
            const parsed = JSON.parse(event.data);
            setParsedMessages((current) => [...current.slice(-49), parsed]);
            onEvent?.(parsed);
          } catch {
            // Ignore malformed messages rather than dropping the socket.
          }
        };

        ws.onclose = () => {
          if (!mounted.current) return;
          setStatus("offline");
          reconnectTimer.current = setTimeout(connect, 4000);
        };

        ws.onerror = () => ws.close();
      } catch {
        setStatus("offline");
        reconnectTimer.current = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      mounted.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [onEvent]);

  return {
    parsedMessages,
    connectionStatus: status,
  };
}
