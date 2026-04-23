"use client";
import { useEffect, useRef, useState, useCallback } from "react";
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
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true);

  const connect = useCallback(() => {
    if (!mounted.current) return;
    const token = getToken();
    if (!token) { setStatus("offline"); return; }

    try {
      const url = `${WS_BASE}?token=${token}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        if (mounted.current) setStatus("live");
      };

      ws.onmessage = (e) => {
        if (!mounted.current) return;
        try {
          const data = JSON.parse(e.data);
          onEvent?.(data);
        } catch {}
      };

      ws.onclose = () => {
        if (!mounted.current) return;
        setStatus("offline");
        // Reconnect after 4 seconds
        reconnectTimer.current = setTimeout(() => {
          if (mounted.current) connect();
        }, 4000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setStatus("offline");
      reconnectTimer.current = setTimeout(() => {
        if (mounted.current) connect();
      }, 4000);
    }
  }, [onEvent]);

  useEffect(() => {
    mounted.current = true;
    connect();
    return () => {
      mounted.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    parsedMessages,
    connectionStatus: status,
  };
}