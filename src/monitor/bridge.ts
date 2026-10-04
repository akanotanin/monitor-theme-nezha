/**
 * 接口桥：上游 nezha-api 的每个函数在这里落地成「极简探针的请求 → 视图模型」。
 *
 * 两处合流是为了别把探针打爆：
 * - 详情页五条曲线各自 useQuery，会同时请求同一个历史接口，这里按 (节点, 窗口) 缓存并合并并发；
 * - 「服务监控」页要按节点逐个取 ping 历史，这里限制并发数。
 */
import type {
	LoginUserResponse,
	MetricPeriod,
	MetricType,
	MonitorResponse,
	ServerGroupResponse,
	ServerMetricsResponse,
	ServiceResponse,
	SettingResponse,
} from "@/types/nezha-api";
import { loadThemeConfig } from "./config";
import {
	fetchHistory,
	fetchMe,
	fetchSnapshot,
	type HistorySeries,
} from "./endpoints";
import {
	buildServiceResponse,
	historyToMonitor,
	historyToServerMetrics,
	toLoginUser,
	toNezhaServer,
	toServerGroups,
	toSetting,
} from "./mapping";
import { periodHours, setHistoryDays } from "./periods";
import type { MonitorHistory, MonitorMe, MonitorNode } from "./types";

const SERVICE_LOOKBACK_HOURS = 720;
const HISTORY_TTL_MS = 20_000;
/**
 * ping 历史的缓存时长。原先是 55 秒 —— 但 ping 序列是**原始样本**，量级完全不是一个档次：
 * 实测真 hub（9 条探测线路）单节点 `hours=720&series=ping` 就有 **791KB**（12,960 行），
 * 而首页会为**每个在线节点**拉一份来填「延迟监控」块（那块默认还是收起的）。
 * 55 秒一过整份重来 → 7 个节点的站开着标签页 ≈ 5.5MB/分钟。
 * 这个块看的是「按天聚合的上行/下行/平均延迟」，分钟级新鲜度毫无意义，所以放到 5 分钟。
 */
const PING_TTL_MS = 300_000;
const SNAPSHOT_TTL_MS = 5_000;
const SERVICE_CONCURRENCY = 4;

let snapshotCache: { at: number; nodes: MonitorNode[] } | null = null;

/**
 * 最近一帧**实时数据**（WS 帧，或 WS 断了时那条 HTTP 兜底轮询拿到的帧 —— 两者是同一份数据）。
 *
 * 为什么要有它：`/api/nodes` 与 `/api/ws` 推的是同一个 `{admin, nodes}`，WS 连着的时候
 * 页面本来就有最新的节点列表，可首页那条 10 秒一次的「有没有延迟监控数据」轮询会顺着
 * `snapshot()` 再回源一次 `/api/nodes`（实测 WS 正常时 25 秒内仍多打 2 次）。
 * 把帧记下来之后，所有要「当前节点列表」的地方都读它，WS 正常时一条 HTTP 都不发。
 */
let liveFrame: { at: number; nodes: MonitorNode[] } | null = null;

/** 兜底：帧停在这么久以前就不再当数据源（WS 与轮询都断了的时候）。 */
const LIVE_FRAME_TTL_MS = 300_000;

/** websocket-provider 每收到一帧就喂进来（见 src/context/websocket-provider.tsx）。 */
export function noteLiveFrame(nodes: MonitorNode[] | undefined): void {
	if (!nodes || nodes.length === 0) return;
	liveFrame = { at: Date.now(), nodes };
}

async function snapshot(force = false): Promise<MonitorNode[]> {
	const now = Date.now();
	// 有新鲜的实时帧就用它：它只会比 HTTP 那份更新，`force`（要「当前」的分组）也没必要回源。
	if (liveFrame && now - liveFrame.at < LIVE_FRAME_TTL_MS)
		return liveFrame.nodes;
	if (!force && snapshotCache && now - snapshotCache.at < SNAPSHOT_TTL_MS) {
		return snapshotCache.nodes;
	}
	const data = await fetchSnapshot();
	const nodes = data.nodes ?? [];
	snapshotCache = { at: now, nodes };
	return nodes;
}

/**
 * 同一次加载里 `/api/me` 会被两条 query 同时打（Header 的「站点设置」与 DashboardLink 的
 * 「登录态」），冷启动时就是两条并发且一模一样的请求。这里只合并**并发**的那一份：
 * 调用方各自决定怎么处理失败（设置那边退默认值、登录态那条要抛错），所以不缓存失败结果。
 *
 * ★标题早跑脚本（public/nezha-title-probe.js）那条 /api/me **刻意不接过来用**（试过，已回退）：
 * 接过来等于把首屏的设置/登录态挂在那个早跑脚本上，它慢或挂了会把首屏一起拖住；而且
 * 「迟到的响应不许改标题」那条护栏赖以成立的前提是两条请求各自独立。代价只是冷启动多一条
 * 几百字节的请求 —— 见 tools/verify_title.mjs 里打出来的两条 /api/me 计数。
 */
let meInflight: Promise<MonitorMe> | null = null;

function fetchMeOnce(): Promise<MonitorMe> {
	if (!meInflight) {
		meInflight = fetchMe().finally(() => {
			meInflight = null;
		});
	}
	return meInflight;
}

async function meOrEmpty(): Promise<MonitorMe> {
	try {
		const me = await fetchMeOnce();
		// 保留天数在这里落到 periods 那个小 store：时间范围那排按钮按它生成（见 periods.ts）。
		// 老 hub 没有这个字段 → 传 undefined → 那边按 7 天算。
		setHistoryDays(me.history_days);
		return me;
	} catch {
		return {};
	}
}

async function nodeById(id: number): Promise<MonitorNode | undefined> {
	const nodes = await snapshot();
	return nodes.find((node) => node.id === id);
}

type HistoryEntry = { at: number; data: MonitorHistory };
const historyCache = new Map<string, HistoryEntry>();
const historyInflight = new Map<string, Promise<MonitorHistory>>();

async function historyFor(
	nodeId: number,
	hours: number,
	series?: HistorySeries,
): Promise<MonitorHistory> {
	const key = `${nodeId}:${hours}:${series ?? "both"}`;
	// ping 是分钟级数据，页面每 10 秒轮询一次没必要每次都回源；
	// 指标曲线要跟手，缓存时间短一些。
	const ttl = series === "ping" ? PING_TTL_MS : HISTORY_TTL_MS;
	const cached = historyCache.get(key);
	if (cached && Date.now() - cached.at < ttl) return cached.data;

	const inflight = historyInflight.get(key);
	if (inflight) return inflight;

	const task = fetchHistory(nodeId, hours, series)
		.then((data) => {
			historyCache.set(key, { at: Date.now(), data });
			return data;
		})
		.finally(() => {
			historyInflight.delete(key);
		});
	historyInflight.set(key, task);
	return task;
}

async function mapWithLimit<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let cursor = 0;
	const runners = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (cursor < items.length) {
				const index = cursor;
				cursor += 1;
				results[index] = await worker(items[index]);
			}
		},
	);
	await Promise.all(runners);
	return results;
}

/** 站点设置：站点名、默认语言、自定义注入代码（上游拿它当哪吒的 setting 用）。 */
export async function bridgeFetchSetting(): Promise<SettingResponse> {
	const [me, config] = await Promise.all([meOrEmpty(), loadThemeConfig()]);
	// 顺带刷新一次快照，避免首屏两个接口都冷启动
	snapshot().catch(() => undefined);
	return toSetting(me, config);
}

export async function bridgeFetchLoginUser(): Promise<LoginUserResponse> {
	return toLoginUser(await fetchMeOnce());
}

export async function bridgeFetchServerGroup(): Promise<ServerGroupResponse> {
	return toServerGroups(await snapshot(true));
}

/** 延迟监控 + 周期流量（替代哪吒的「服务监控」）。 */
export async function bridgeFetchService(
	hours: number = SERVICE_LOOKBACK_HOURS,
): Promise<ServiceResponse> {
	const nodes = await snapshot();
	const targets = nodes.filter((node) => node.online !== false);
	const histories = await mapWithLimit(
		targets,
		SERVICE_CONCURRENCY,
		async (node) => {
			try {
				const data = await historyFor(node.id, hours, "ping");
				return [node.id, data] as const;
			} catch {
				return [node.id, null] as const;
			}
		},
	);

	const byNode = new Map<number, MonitorHistory>();
	for (const [id, data] of histories) {
		if (data) byNode.set(id, data);
	}
	return buildServiceResponse(nodes, byNode);
}

export async function bridgeFetchServerMetrics(
	serverId: number,
	metric: MetricType,
	period: MetricPeriod = "1d",
): Promise<ServerMetricsResponse> {
	const [history, node] = await Promise.all([
		historyFor(serverId, periodHours(period), "metrics"),
		nodeById(serverId),
	]);
	return historyToServerMetrics(
		history,
		metric,
		serverId,
		node?.name ?? String(serverId),
	);
}

export async function bridgeFetchMonitor(
	serverId: number,
	period: MetricPeriod = "1d",
): Promise<MonitorResponse> {
	const [history, node] = await Promise.all([
		historyFor(serverId, periodHours(period), "ping"),
		nodeById(serverId),
	]);
	const fallback: MonitorNode = node ?? {
		id: serverId,
		name: String(serverId),
	};
	return historyToMonitor(fallback, history);
}

/** 供 websocket-provider 把帧翻译成上游视图模型。 */
export async function bridgeNodeName(id: number): Promise<string> {
	const node = await nodeById(id);
	return node?.name ?? String(id);
}

export { toNezhaServer };
