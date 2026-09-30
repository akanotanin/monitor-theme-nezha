import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSnapshot } from "@/monitor/endpoints";
import { toNezhaServer } from "@/monitor/mapping";
import type { MonitorNode } from "@/monitor/types";
import type { NezhaWebsocketResponse } from "@/types/nezha-api";
import {
	WebSocketContext,
	type WebSocketContextType,
} from "./websocket-context";

interface WebSocketProviderProps {
	url: string;
	children: React.ReactNode;
}

/**
 * WS 连不上时的 HTTP 兜底轮询间隔。探针的 `/api/nodes` 与 WS 推的是同一个帧，
 * 5 秒一次足够让页面「活着」；WS 一旦连上就立刻停掉。
 */
const HTTP_FALLBACK_MS = 5000;

/** 极简探针的帧：`{admin, nodes:[…]}`，与 /api/nodes 的回包是同一个。 */
type MonitorFrame = {
	admin?: boolean;
	nodes?: MonitorNode[];
};

/**
 * 把探针的帧翻成上游认识的样子。
 *
 * 上游整棵组件树都按 `{now, online, servers}` 读数据，所以这里做一次映射；
 * `now` 由本地时钟给（探针的帧里没有时间戳），单位是毫秒 —— 上游的
 * formatNezhaInfo 就是按毫秒算在线状态的。
 */
function normalizeWebSocketResponse(data: unknown): NezhaWebsocketResponse {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new TypeError("WebSocket message must be an object");
	}

	const frame = data as MonitorFrame;
	const now = Date.now();
	const servers = (Array.isArray(frame.nodes) ? frame.nodes : []).map((node) =>
		toNezhaServer(node, now),
	);

	return {
		now,
		online: servers.filter((server) => server.online).length,
		servers,
	};
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
	url,
	children,
}) => {
	const [lastData, setLastData] = useState<NezhaWebsocketResponse | null>(null);
	const [messageHistory, setMessageHistory] = useState<
		NezhaWebsocketResponse[]
	>([]);
	// WS 本身连上没有（决定要不要走 HTTP 兜底）
	const [wsConnected, setWsConnected] = useState(false);
	// HTTP 兜底是不是正在供数据
	const [polling, setPolling] = useState(false);
	const [needReconnect, setNeedReconnect] = useState(false);
	const ws = useRef<WebSocket | null>(null);
	const reconnectTimeout = useRef<NodeJS.Timeout>(null);
	const maxReconnectAttempts = 30;
	const reconnectAttempts = useRef(0);
	const isConnecting = useRef(false);

	/**
	 * 把一帧数据落到 state 上。WS 与 HTTP 兜底共用这一条通道 ——
	 * 两条路来的帧形状完全一样（探针的 `/api/nodes` 与 `/api/ws` 推的是同一个 `{admin, nodes}`）。
	 */
	const applyFrame = useCallback((frame: unknown) => {
		try {
			const newData = normalizeWebSocketResponse(frame);
			setLastData(newData);
			// 更新历史消息，保持最新的30条记录
			setMessageHistory((prev) => {
				const updated = [newData, ...prev];
				return updated.slice(0, 30);
			});
		} catch (error) {
			console.error("Failed to parse frame:", error);
		}
	}, []);

	const cleanup = useCallback(() => {
		if (ws.current) {
			// 移除所有事件监听器
			ws.current.onopen = null;
			ws.current.onclose = null;
			ws.current.onmessage = null;
			ws.current.onerror = null;

			if (
				ws.current.readyState === WebSocket.OPEN ||
				ws.current.readyState === WebSocket.CONNECTING
			) {
				ws.current.close();
			}
			ws.current = null;
		}
		if (reconnectTimeout.current) {
			clearTimeout(reconnectTimeout.current);
			reconnectTimeout.current = null;
		}
		setWsConnected(false);
	}, []);

	const connect = useCallback(() => {
		if (isConnecting.current) {
			console.log("Connection already in progress");
			return;
		}

		cleanup();
		isConnecting.current = true;

		try {
			const wsUrl = new URL(url, window.location.origin);
			wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

			ws.current = new WebSocket(wsUrl.toString());

			ws.current.onopen = () => {
				console.log("WebSocket connected");
				setWsConnected(true);
				reconnectAttempts.current = 0;
				isConnecting.current = false;
			};

			ws.current.onclose = () => {
				console.log("WebSocket disconnected");
				setWsConnected(false);
				ws.current = null;
				isConnecting.current = false;

				if (reconnectAttempts.current < maxReconnectAttempts) {
					reconnectTimeout.current = setTimeout(() => {
						reconnectAttempts.current++;
						connect();
					}, 3000);
				}
			};

			ws.current.onmessage = (event) => {
				try {
					if (typeof event.data !== "string") {
						throw new Error("WebSocket message data must be a string");
					}

					applyFrame(JSON.parse(event.data));
				} catch (error) {
					console.error("Failed to parse WebSocket message:", error);
				}
			};

			ws.current.onerror = (error) => {
				console.error("WebSocket error:", error);
				isConnecting.current = false;
			};
		} catch (error) {
			console.error("WebSocket connection error:", error);
			isConnecting.current = false;
		}
	}, [cleanup, url, applyFrame]);

	const reconnect = () => {
		reconnectAttempts.current = 0;
		// 等待一个小延时确保清理完成
		cleanup();
		setTimeout(() => {
			connect();
		}, 1000);
	};

	useEffect(() => {
		connect();

		// 添加页面卸载事件监听
		const handleBeforeUnload = () => {
			cleanup();
		};

		window.addEventListener("beforeunload", handleBeforeUnload);

		return () => {
			cleanup();
			window.removeEventListener("beforeunload", handleBeforeUnload);
		};
	}, [cleanup, connect]);

	/**
	 * WS 连不上时的 HTTP 兜底。
	 *
	 * 为什么必须有：反代没转发 `Upgrade`（或 WS 被 WAF 拦）时，整站就只剩一个「离线」徽标
	 * 和一张永远空白的列表 —— 而 `/api/nodes` 明明照常能用（实测：把 WS 摘掉后等了 27 秒，
	 * 一个节点都没出来）。帧形状与 WS 一样，所以直接走同一条 applyFrame。
	 * WS 一连上就停（不在两条路上重复打接口）。
	 */
	useEffect(() => {
		if (wsConnected) return;
		let cancelled = false;
		const tick = () => {
			fetchSnapshot()
				.then((frame) => {
					if (cancelled) return;
					applyFrame(frame);
					setPolling(true);
				})
				.catch(() => {
					if (!cancelled) setPolling(false);
				});
		};
		tick();
		const timer = setInterval(tick, HTTP_FALLBACK_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
			setPolling(false);
		};
	}, [wsConnected, applyFrame]);

	// 「连着」= 有实时数据在流动：WS 通就算通，WS 断了但 HTTP 兜底在供数据也算 ——
	// 否则会出现「页面数据在刷新、徽标却写着离线」这种自相矛盾的状态。
	const connected = wsConnected || polling;

	const contextValue: WebSocketContextType = {
		lastData,
		connected,
		messageHistory,
		reconnect,
		needReconnect,
		setNeedReconnect,
	};

	return (
		<WebSocketContext.Provider value={contextValue}>
			{children}
		</WebSocketContext.Provider>
	);
};
