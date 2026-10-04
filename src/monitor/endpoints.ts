/**
 * 极简探针的接口入口。上游所有请求都经过这里，改地址只改这一个文件。
 */
import type { MonitorHistory, MonitorMe, MonitorSnapshot } from "./types";

/** 安装目录名，同时也是配置键。改这个值等于让已装实例丢设置。 */
export const THEME_SHORT = "nezha";

export const endpoints = {
	/** 实时快照，与 /api/ws 推的是同一个帧。 */
	snapshot: "/api/nodes",
	me: "/api/me",
	ws: "/api/ws",
	history: (id: number) => `/api/nodes/${id}/metrics`,
	themeConfig: () => `/api/themes/${THEME_SHORT}/config`,
} as const;

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url, { credentials: "same-origin" });
	if (!res.ok)
		throw new Error(`请求 ${url} 失败：${res.status} ${res.statusText}`);
	return (await res.json()) as T;
}

export const fetchSnapshot = () => getJson<MonitorSnapshot>(endpoints.snapshot);

export const fetchMe = () => getJson<MonitorMe>(endpoints.me);

/** 读取主题配置；没保存过时 hub 回 `{}`。 */
export const fetchThemeConfig = () =>
	getJson<Record<string, unknown>>(endpoints.themeConfig());

export type HistorySeries = "metrics" | "ping";

/**
 * 历史数据。`hours` 是窗口长度，`series` 只取一半（探针按半序列记账，
 * 只要一种时把另一种关掉能省下三分之一到三分之二的响应体）。
 */
export async function fetchHistory(
	id: number,
	hours: number,
	series?: HistorySeries,
): Promise<MonitorHistory> {
	const params = new URLSearchParams({ hours: String(hours) });
	if (series) params.set("series", series);
	return getJson<MonitorHistory>(
		`${endpoints.history(id)}?${params.toString()}`,
	);
}
