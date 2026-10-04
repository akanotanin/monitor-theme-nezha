/**
 * 时间范围（1 天 / 7 天 / 30 天 / 90 天 / 365 天）由 hub 的**保留天数**决定。
 *
 * hub 1.3.2 起 `/api/nodes/{id}/metrics` 的 `hours` 上限就是保留天数本身（登录与匿名相同），
 * 而主题这边原来写死三档：在只留 7 天的 hub 上「30 天」是个空窗口（hub 会静默收窄，
 * 图与按钮上的字就对不上），在留 365 天的 hub 上又只能看到 30 天。
 *
 * 保留天数从 `/api/me` 来（bridge 拿到就写进这里），所以做成一个**可订阅的小 store**：
 * 它是异步到的，图表组件挂载时可能还没到——订阅一下，到了自己重排那排按钮。
 */
import { useSyncExternalStore } from "react";
import type { MetricPeriod } from "@/types/nezha-api";

/** 窗口阶梯：只列这五档，够得着的才出现。 */
const LADDER: MetricPeriod[] = ["1d", "7d", "30d", "90d", "365d"];

const HOURS: Record<MetricPeriod, number> = {
	"1d": 24,
	"7d": 168,
	"30d": 720,
	"90d": 2160,
	"365d": 8760,
};

/** 这一档要请求多少小时。新档位（90d / 365d）也在这里，别处不用再写一份表。 */
export function periodHours(period: MetricPeriod): number {
	return HOURS[period] ?? 24;
}

/** 老 hub 没有 `history_days`：按 7 天算，结果正好是 1.15.x 时代那排（1 天 / 7 天）。 */
const DEFAULT_DAYS = 7;

let cachedDays: number | null = null;
const listeners = new Set<() => void>();

/** bridge 拿到 `/api/me` 就写进来；`undefined`（老 hub）按 7 天算。 */
export function setHistoryDays(days: number | undefined): void {
	const next =
		typeof days === "number" && Number.isFinite(days)
			? Math.min(365, Math.max(1, Math.floor(days)))
			: null;
	if (next === cachedDays) return;
	cachedDays = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** 保留天数（老 hub 或还没拿到时 = 7）。 */
export function historyDays(): number {
	return cachedDays ?? DEFAULT_DAYS;
}

/**
 * 够得着的窗口。规则与 jikasei 那排一致：每一档都不超过保留天数，至少留「1 天」；
 * 保留 30 天就是 1 天 / 7 天 / 30 天（与改动前逐字相同），留 365 天才多出 90 天与 365 天。
 */
export function periodsFor(days: number = historyDays()): MetricPeriod[] {
	const cap = Math.max(1, Math.min(365, Math.floor(days))) * 24;
	const fit = LADDER.filter((period) => periodHours(period) <= cap);
	return fit.length > 0 ? fit : ["1d"];
}

/** 组件用这个：保留天数到了/变了会自己重排。 */
export function usePeriods(): MetricPeriod[] {
	const days = useSyncExternalStore(subscribe, historyDays, historyDays);
	return periodsFor(days);
}
