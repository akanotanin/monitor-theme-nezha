/**
 * 把极简探针的数据翻译成上游组件认识的「哪吒视图模型」。
 *
 * 上游组件（ServerCard / ServerDetail* / ServerFlag / GroupSwitch …）读的一直是
 * NezhaServer / ServerGroupResponse / ServiceResponse 这些结构，这里现场造出来，
 * 于是 UI 一行都不用改。
 */
import dayjs from "dayjs";
import type {
	LoginUserResponse,
	MetricType,
	MonitorResponse,
	NezhaMonitor,
	NezhaServer,
	ServerGroup,
	ServerGroupResponse,
	ServerMetricsResponse,
	ServiceData,
	ServiceResponse,
	SettingResponse,
} from "@/types/nezha-api";
import type { ThemeConfig } from "./config";
import {
	getThemeConfig,
	type RemarkPlacement,
	remarksOnCards,
	resolvePlanTagsFor,
} from "./config";
import type {
	MonitorHistory,
	MonitorHistorySample,
	MonitorMe,
	MonitorNode,
	MonitorPingRow,
} from "./types";

const num = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * ping 行的延迟：hub 对「丢包」那一格可能给 null、甚至整字段缺失，
 * 直接参与算术/交给上游组件会炸（上游 NetworkChart 会 null.toFixed）。
 * 所以统一收敛成数字：>=0 视为延迟，其它（null/负数/非数）视为丢包。
 */
const pingLatency = (row: {
	latency?: unknown;
}): { delay: number; lost: boolean } => {
	const raw = Number(row?.latency);
	return Number.isFinite(raw) && raw >= 0
		? { delay: raw, lost: false }
		: { delay: 0, lost: true };
};

/** 探针的 last_seen 是秒，哪吒的 last_active 是 ISO 字符串。 */
const isoFromSeconds = (seconds?: number): string =>
	typeof seconds === "number" && seconds > 0
		? new Date(seconds * 1000).toISOString()
		: new Date(0).toISOString();

const CURRENCY_SYMBOL: Record<string, string> = {
	CNY: "¥",
	RMB: "¥",
	USD: "$",
	EUR: "€",
	GBP: "£",
	JPY: "¥",
	HKD: "HK$",
	RUB: "₽",
};

/** 账单周期：探针给 monthly/yearly/…，上游认「月/季/半年/年」。 */
function cycleLabel(cycle?: string | null): string {
	switch ((cycle ?? "").toLowerCase()) {
		case "monthly":
		case "month":
		case "m":
			return "月";
		case "quarterly":
		case "quarter":
			return "季";
		case "semiannually":
		case "half-year":
		case "half":
			return "半年";
		case "yearly":
		case "annually":
		case "year":
		case "y":
			return "年";
		default:
			return "";
	}
}

function cycleMonths(cycle?: string | null): number {
	switch ((cycle ?? "").toLowerCase()) {
		case "monthly":
		case "month":
		case "m":
			return 1;
		case "quarterly":
		case "quarter":
			return 3;
		case "semiannually":
		case "half":
			return 6;
		case "yearly":
		case "annually":
		case "year":
		case "y":
			return 12;
		default:
			return 1;
	}
}

/** 探针给的是完整系统名（"Debian GNU/Linux 12 (bookworm)"），上游认 "debian" 这种短名。 */
export function platformFromOs(os?: string | null): {
	platform: string;
	version: string;
} {
	const text = os ?? "";
	const lower = text.toLowerCase();
	const table: [string, string][] = [
		["debian", "debian"],
		["ubuntu", "ubuntu"],
		["alpine", "alpine"],
		["rocky", "rocky-linux"],
		["almalinux", "almalinux"],
		["alma", "almalinux"],
		["centos", "centos"],
		["fedora", "fedora"],
		["opensuse", "opensuse"],
		["suse", "opensuse"],
		["arch", "archlinux"],
		["manjaro", "manjaro"],
		["gentoo", "gentoo"],
		["nixos", "nixos"],
		["openwrt", "openwrt"],
		["freebsd", "freebsd"],
		["openbsd", "openbsd"],
		["windows", "windows"],
		["darwin", "macos"],
		["macos", "macos"],
	];
	const hit = table.find(([needle]) => lower.includes(needle));
	const versionMatch = text.match(/\b(\d+(?:\.\d+)*)\b/);
	const parenthetical = text.match(/\(([^)]+)\)/);
	return {
		platform: hit ? hit[1] : "linux",
		version: parenthetical?.[1] ?? versionMatch?.[1] ?? "",
	};
}

/**
 * 造出上游的 public_note（账单 / 套餐标签）。哪吒是让站长在这条备注里手写 JSON，
 * 极简探针把这些信息存成了节点字段，这里反过来拼成同一个 JSON。
 */
function currentRemarkPlacement(): RemarkPlacement {
	return getThemeConfig().remarkPlacement;
}

export function buildPublicNote(
	node: MonitorNode,
	/** 「备注显示位置」：卡片那一侧关掉时（`detail` / `none`）不把备注来的芯片塞进 public_note。 */
	placement: RemarkPlacement = currentRemarkPlacement(),
): string {
	const cycle = cycleLabel(node.billing_cycle);
	// 探针把「价格」存成节点字段（0 = 明确免费，null = 没填），哪吒那边是站长在公开备注里手写：
	// amount="0" 上游渲染成绿色「免费」，endDate 以 0000-00-00 开头渲染成「永久」（见上游 billingInfo.tsx）
	const hasPrice = node.price !== null && node.price !== undefined;
	const hasBilling = Boolean(node.expires_at) || hasPrice || Boolean(cycle);
	// 标签可能来自主题设置，也可能来自 hub 的公开备注（探针没有带宽/IP 数据源）：
	// 规则匹配到了用规则的，没匹配到用后台那条备注（见 config.ts 的 resolvePlanTagsFor）。
	// 有标签也要生成 planDataMod。
	// 「备注显示位置」管的是**备注来的**那几个芯片（带宽 / IPv4 / IPv6 / 灰标签），
	// 流量配额与账单不属于备注，所以卡片侧关掉时它们照旧显示（见 @/monitor/config）。
	const tags = remarksOnCards(placement)
		? resolvePlanTagsFor(node)
		: { bandwidth: "", ipv4: false, ipv6: false, extra: "" };
	const hasPlan =
		Boolean(node.traffic_limit) ||
		Boolean(node.traffic_mode) ||
		Boolean(tags.bandwidth) ||
		tags.ipv4 ||
		tags.ipv6 ||
		Boolean(tags.extra);

	if (!hasBilling && !hasPlan) return "";

	const note: Record<string, unknown> = {};

	if (hasBilling) {
		const endDate = node.expires_at ?? "0000-00-00";
		const startDate = node.expires_at
			? dayjs(node.expires_at)
					.subtract(cycleMonths(node.billing_cycle), "month")
					.format("YYYY-MM-DD")
			: "";
		const price = node.price;
		const symbol = CURRENCY_SYMBOL[(node.currency ?? "").toUpperCase()] ?? "";
		note.billingDataMod = {
			startDate,
			endDate,
			autoRenewal: "",
			cycle,
			amount: !hasPrice ? "" : price === 0 ? "0" : `${symbol}${price}`,
		};
	}

	if (hasPlan) {
		note.planDataMod = {
			bandwidth: tags.bandwidth,
			// 探针的流量按月重置（traffic_reset_day = 每月几号），所以带上「/月」；
			// 没有重置日的节点不是月度配额，就不加后缀
			trafficVol: node.traffic_limit
				? `${formatBytesShort(node.traffic_limit)}${num(node.traffic_reset_day ?? 0) > 0 ? "/月" : ""}`
				: "",
			trafficType: "",
			IPv4: tags.ipv4 ? "1" : "",
			IPv6: tags.ipv6 ? "1" : "",
			networkRoute: "",
			extra: tags.extra,
		};
	}

	return JSON.stringify(note);
}

function formatBytesShort(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Monitor 节点 → 哪吒的服务器视图模型。
 *
 * 单位沿用哪吒的约定（内存/磁盘/流量是字节，速率是字节/秒，CPU 是百分比），
 * 上游的图表 transform 靠这些单位换算，不要在这里提前转成百分比。
 */
export function toNezhaServer(node: MonitorNode, nowMs: number): NezhaServer {
	const metrics = node.metrics ?? {};
	const load = Array.isArray(metrics.load) ? metrics.load : [];
	const uptime = num(metrics.uptime);
	const { platform, version } = platformFromOs(node.os);
	const cpuName = node.cpu_name ?? "";
	const cores = node.cpu_cores ?? 0;

	return {
		id: node.id,
		name: node.name,
		public_note: buildPublicNote(node),
		// 备注原文原样带过去（不参与 public_note 的标签拼装）：详情页那一块要的是原文，
		// 拿它按「私有在前、公有在后」拼成合并的一串（见 @/monitor/config 的 remarkChips）。
		remark: node.remark ?? "",
		public_remark: node.public_remark ?? "",
		last_active: isoFromSeconds(node.last_seen),
		country_code: (node.country ?? "").toUpperCase(),
		host: {
			platform,
			platform_version: version,
			cpu: cpuName ? [cores ? `${cpuName} ×${cores}` : cpuName] : [],
			gpu: [],
			mem_total: num(metrics.mem_total, num(node.mem_total)),
			disk_total: num(metrics.disk_total, num(node.disk_total)),
			swap_total: num(metrics.swap_total, num(node.swap_total)),
			arch: node.arch ?? "",
			// 哪吒的 boot_time 是秒；极简探针给的是已运行秒数，倒推开机时刻
			boot_time: Math.floor(nowMs / 1000) - uptime,
			version: node.agent_version ?? "",
		},
		state: {
			cpu: num(metrics.cpu),
			mem_used: num(metrics.mem_used),
			swap_used: num(metrics.swap_used),
			disk_used: num(metrics.disk_used),
			// 哪吒这里是「自开机累计」，极简探针公开接口只给到「本计费周期」，
			// 所以卡片/周期流量用的是周期口径（与探针面板的流量列一致）
			net_in_transfer: num(
				metrics.month_rx,
				num(node.month_rx, num(node.total_rx)),
			),
			net_out_transfer: num(
				metrics.month_tx,
				num(node.month_tx, num(node.total_tx)),
			),
			net_in_speed: num(metrics.net_rx),
			net_out_speed: num(metrics.net_tx),
			uptime,
			load_1: num(load[0]),
			load_5: num(load[1]),
			load_15: num(load[2]),
			tcp_conn_count: num(metrics.tcp),
			udp_conn_count: num(metrics.udp),
			process_count: num(metrics.procs),
			// 极简探针不下发温度与 GPU，界面上的入口也一并去掉了
			temperatures: [],
			gpu: [],
		},
		// 附加字段：在线与否以 hub 的判定为准，见 lib/utils.ts
		online: node.online === true,
	};
}

/** 分组：极简探针的 group 是节点上的一个字符串字段。 */
export function toServerGroups(nodes: MonitorNode[]): ServerGroupResponse {
	const byGroup = new Map<string, number[]>();
	for (const node of nodes) {
		const name = (node.group ?? "").trim();
		if (!name) continue;
		const list = byGroup.get(name) ?? [];
		list.push(node.id);
		byGroup.set(name, list);
	}
	const data: ServerGroup[] = [...byGroup.entries()].map(
		([name, servers], index) => ({
			group: {
				id: index + 1,
				created_at: "",
				updated_at: "",
				name,
			},
			servers,
		}),
	);
	return { success: true, data };
}

export function toLoginUser(me: MonitorMe): LoginUserResponse {
	const authed = me.authed === true;
	return {
		success: true,
		data: {
			id: authed ? 1 : 0,
			username: me.github ?? (authed ? "admin" : ""),
			password: "",
			created_at: "",
			updated_at: "",
		},
	};
}

export function toSetting(me: MonitorMe, cfg: ThemeConfig): SettingResponse {
	return {
		success: true,
		data: {
			config: {
				debug: false,
				language: cfg.language,
				site_name: me.site_name ?? "",
				user_template: "",
				admin_template: "",
				custom_code: cfg.customCode,
			},
			version: "",
			// 极简探针存历史，详情页的历史曲线可以照常画
			tsdb_enabled: true,
		},
	};
}

/** 上游要的指标名 → 极简探针历史里真实存在的列。 */
const METRIC_SERIES: Partial<Record<MetricType, keyof MonitorHistorySample>> = {
	cpu: "cpu",
	memory: "mem_used",
	disk: "disk_used",
	net_in_speed: "net_rx",
	net_out_speed: "net_tx",
};

/**
 * 历史指标。极简探针一次回所有列，这里按请求的指标切出一列；
 * ts 由秒转毫秒（上游的 X 轴按毫秒解析）。
 */
export function historyToServerMetrics(
	history: MonitorHistory,
	metric: MetricType,
	serverId: number,
	serverName: string,
): ServerMetricsResponse {
	const series = METRIC_SERIES[metric];
	const dataPoints = series
		? (history.metrics ?? [])
				.map((sample) => ({
					ts: sample.ts * 1000,
					value: num(sample[series]),
				}))
				.filter((point) => Number.isFinite(point.value))
		: [];
	return {
		success: true,
		data: {
			server_id: serverId,
			server_name: serverName,
			metric,
			data_points: dataPoints,
		},
	};
}

/** 延迟监控：一条探测线路 = 一个「监控项」，失败的一次记 100% 丢包。 */
export function historyToMonitor(
	node: MonitorNode,
	history: MonitorHistory,
): MonitorResponse {
	const probes = history.probes ?? {};
	const byTask = new Map<number, MonitorPingRow[]>();
	for (const row of history.ping ?? []) {
		const list = byTask.get(row.task_id) ?? [];
		list.push(row);
		byTask.set(row.task_id, list);
	}

	const ids = [...byTask.keys()].sort((a, b) => a - b);
	const data: NezhaMonitor[] = ids.map((taskId, index) => {
		const rows = (byTask.get(taskId) ?? []).slice().sort((a, b) => a.ts - b.ts);
		return {
			monitor_id: taskId,
			monitor_name: probes[String(taskId)] ?? `#${taskId}`,
			display_index: index,
			server_id: node.id,
			server_name: node.name,
			created_at: rows.map((row) => row.ts * 1000),
			avg_delay: rows.map((row) => pingLatency(row).delay),
			packet_loss: rows.map((row) => (pingLatency(row).lost ? 100 : 0)),
		};
	});

	return { success: true, data };
}

const SERVICE_DAYS = 30;

/**
 * 「服务监控」页的替代品：极简探针没有 HTTP 拨测，但有 Ping 探测线路。
 * 一条线路聚合成上游的一张卡（30 天每天的可用性 + 平均延迟 + 丢包）。
 */
export function buildServiceResponse(
	nodes: MonitorNode[],
	histories: Map<number, MonitorHistory>,
): ServiceResponse {
	type Bucket = { up: number; down: number; delaySum: number };
	const byTask = new Map<
		number,
		{ name: string; serverNames: Set<string>; days: Bucket[] }
	>();

	const today = dayjs().startOf("day");
	const dayIndex = (ts: number) => {
		const diff = today.diff(dayjs.unix(ts).startOf("day"), "day");
		const index = SERVICE_DAYS - 1 - diff;
		return index >= 0 && index < SERVICE_DAYS ? index : -1;
	};

	for (const node of nodes) {
		const history = histories.get(node.id);
		if (!history) continue;
		const probes = history.probes ?? {};
		for (const row of history.ping ?? []) {
			const index = dayIndex(row.ts);
			if (index < 0) continue;
			let entry = byTask.get(row.task_id);
			if (!entry) {
				entry = {
					name: probes[String(row.task_id)] ?? `#${row.task_id}`,
					serverNames: new Set<string>(),
					days: Array.from({ length: SERVICE_DAYS }, () => ({
						up: 0,
						down: 0,
						delaySum: 0,
					})),
				};
				byTask.set(row.task_id, entry);
			}
			entry.serverNames.add(node.name);
			const bucket = entry.days[index];
			const { delay, lost } = pingLatency(row);
			if (lost) {
				bucket.down += 1;
			} else {
				bucket.up += 1;
				bucket.delaySum += delay;
			}
		}
	}

	const services: Record<string, ServiceData> = {};
	for (const [taskId, entry] of byTask) {
		const todayBucket = entry.days[SERVICE_DAYS - 1];
		const totalUp = entry.days.reduce((sum, day) => sum + day.up, 0);
		const totalDown = entry.days.reduce((sum, day) => sum + day.down, 0);
		services[String(taskId)] = {
			service_name: `${entry.name}（${entry.serverNames.size} 个节点）`,
			current_up: todayBucket.up,
			current_down: todayBucket.down,
			total_up: totalUp,
			total_down: totalDown,
			delay: entry.days.map((day) =>
				day.up > 0 ? Math.round(day.delaySum / day.up) : 0,
			),
			up: entry.days.map((day) => day.up),
			down: entry.days.map((day) => day.down),
		};
	}

	// 周期流量：极简探针按节点各算各的额度，所以一张卡对一个节点
	const cycleStats: ServiceResponse["data"]["cycle_transfer_stats"] = {};
	for (const node of nodes) {
		const max = num(node.traffic_limit);
		const from = node.month_start ?? "";
		if (!max || !from) continue;
		const cycleKey = `traffic-${node.group || "all"}`;
		const to = dayjs(from).add(1, "month").toISOString();
		const existing = cycleStats[cycleKey] ?? {
			name: node.group ? `${node.group} 流量` : "周期流量",
			from: {} as Record<string, string>,
			to: {} as Record<string, string>,
			max: {} as Record<string, number>,
			min: {} as Record<string, number>,
			server_name: {} as Record<string, string>,
			transfer: {} as Record<string, number>,
			next_update: {} as Record<string, string>,
		};
		const key = String(node.id);
		(existing.from as Record<string, string>)[key] = dayjs(from).toISOString();
		(existing.to as Record<string, string>)[key] = to;
		(existing.max as Record<string, number>)[key] = max;
		(existing.min as Record<string, number>)[key] = 0;
		existing.server_name[key] = node.name;
		existing.transfer[key] = num(
			node.month_used,
			num(node.month_rx) + num(node.month_tx),
		);
		existing.next_update[key] = to;
		cycleStats[cycleKey] = existing;
	}

	return {
		success: true,
		data: { services, cycle_transfer_stats: cycleStats },
	};
}
