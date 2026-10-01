"use client";

// WebSocket reconnect/auth.
//
// The session is an HttpOnly cookie, which a WebSocket handshake cannot carry.
// So on connect the page exchanges its session for a short-lived ticket via
// POST /auth/ws-ticket and presents that in the first frame.
//
// The ticket is held in memory only (never sessionStorage/localStorage). The
// previous build kept the full session JWT in sessionStorage solely to satisfy
// this handshake, which made a long-lived, script-readable credential outlive
// every tab it should not have.

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE, getWebSocketTicket, issueWebSocketTicket } from "@/lib/api";

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
  const onEventRef = useRef(onEvent);

  // Keep the latest handler without re-running the connection effect on every
  // render. The old dependency array reconnected the socket whenever the
  // consumer's callback identity changed, which produced avoidable drops.
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    mounted.current = true;

    const connect = async () => {
      if (!mounted.current) return;

      // An authenticated app must hold a ticket; if it has none, there is no
      // session worth opening a socket for.
      if (!getWebSocketTicket()) {
        try {
          await issueWebSocketTicket();
        } catch {
          if (mounted.current) setStatus("offline");
          return;
        }
      }
      if (!mounted.current) return;

      const ticket = getWebSocketTicket();
      if (!ticket) {
        setStatus("offline");
        return;
      }

      setStatus("connecting");

      try {
        const ws = new WebSocket(WS_BASE);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted.current) return;
          const current = getWebSocketTicket();
          if (current) {
            // The ticket is sent in the FIRST frame, never in the URL query
            // string, so it cannot leak into access logs, proxies or history.
            ws.send(JSON.stringify({ type: "auth", ticket: current }));
            setStatus("live");
          } else {
            ws.close();
          }
        };

        ws.onmessage = (event) => {
          if (!mounted.current) return;
          try {
            const parsed = JSON.parse(event.data);
            setParsedMessages((current) => [...current.slice(-49), parsed]);
            onEventRef.current?.(parsed);
          } catch {
            // Ignore malformed messages rather than dropping the socket.
          }
        };

        ws.onclose = (event) => {
          if (!mounted.current) return;
          setStatus("offline");
          // Auth rejection (4001) and too-many-connections (4002) are terminal:
          // reconnecting would just hammer the server with a ticket that cannot
          // work (e.g. the session was revoked).
          if (event.code === 4001 || event.code === 4002) return;
          reconnectTimer.current = setTimeout(() => void connect(), 4000);
        };

        ws.onerror = () => ws.close();
      } catch {
        setStatus("offline");
        reconnectTimer.current = setTimeout(() => void connect(), 4000);
      }
    };

    void connect();

    return () => {
      mounted.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return {
    parsedMessages,
    connectionStatus: status,
  };
}
