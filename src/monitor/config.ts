/**
 * 主题设置（后台「主题 → 主题设置」里改），对应上游用 window 全局变量接的那些站点级开关。
 *
 * 上游原本靠哪吒的服务端模板往页面里塞 `window.ForceShowMap` 之类的变量；
 * 极简探针的主题包是纯静态文件，没有模板可注入，所以这些值改由主题配置下发，
 * 启动时由 applyWindowGlobals() 写回 window —— 组件因此一行都不用改。
 */
import { fetchThemeConfig } from "./endpoints";

export interface ThemeConfig {
	/** 站标（图片地址）。 */
	customLogo: string;
	customBackgroundImage: string;
	customMobileBackgroundImage: string;
	customIllustration: string;
	/** JSON 数组：[{"name":"...","link":"..."}]。 */
	customLinks: string;
	/** 注入到页面的自定义 HTML/JS。 */
	customCode: string;
	/** 站点默认语言，留空表示跟随访客浏览器。 */
	language: string;
	/** 卡片底部标签规则（每行「匹配 = 标签,标签」）。 */
	planTags: string;
	/** 「备注显示位置」：备注摊在哪儿（卡片 / 整页详情 / 两边 / 都不显示，见 remarkPlacement 那一节）。 */
	remarkPlacement: RemarkPlacement;
	forceTheme: string;
	forceSortType: string;
	forceSortOrder: string;
	forceShowMap: boolean;
	forceShowServices: boolean;
	forceCardInline: boolean;
	forceUseSvgFlag: boolean;
	disableAnimatedMan: boolean;
	forcePeakCutEnabled: boolean;
}

/**
 * 「备注显示位置」：`both` 卡片与详情页（默认）/ `card` 只在卡片 / `detail` 只在整页详情 /
 * `none` 都不显示。与 jikasei 1.19.1 同一个字段名与同一套取值（面板里也是同一个下拉框）。
 */
export type RemarkPlacement = "both" | "card" | "detail" | "none";

/** 四档取值（`coerce` 认这四样，别的都回落到 `both`）。 */
export const REMARK_PLACEMENTS: RemarkPlacement[] = [
	"both",
	"card",
	"detail",
	"none",
];

/**
 * 卡片那一侧（卡片底部那排芯片）要不要摊备注。与 `remarksOnDetail` 是一对。
 *
 * ★写成**白名单**（只认 `both`/`card`）而不是「不等于 detail」：后者在新增第四档「都不显示」时会
 * 悄悄把卡片侧漏开（备注没关掉），是那种「看着改了、其实没生效」的坏实现。
 */
export function remarksOnCards(p: RemarkPlacement): boolean {
	return p === "both" || p === "card";
}

/** 整页详情（点进去那一页）要不要摊备注。同样写成白名单。 */
export function remarksOnDetail(p: RemarkPlacement): boolean {
	return p === "both" || p === "detail";
}

/** 默认值：站标用极简探针自己的默认图标，不沿用原项目图标。 */
export const defaultThemeConfig: ThemeConfig = {
	customLogo: "/favicon.svg",
	customBackgroundImage: "",
	customMobileBackgroundImage: "",
	customIllustration: "/character.webp",
	customLinks: "",
	customCode: "",
	language: "zh-CN",
	planTags: "",
	// 备注显示位置：默认两边都摊（与 jikasei 1.19.1 同口径）。
	remarkPlacement: "both",
	forceTheme: "",
	forceSortType: "",
	forceSortOrder: "",
	forceShowMap: false,
	forceShowServices: false,
	forceCardInline: false,
	forceUseSvgFlag: false,
	disableAnimatedMan: false,
	forcePeakCutEnabled: true,
};

const asString = (value: unknown, fallback: string) =>
	typeof value === "string" ? value : fallback;
const asBoolean = (value: unknown, fallback: boolean) =>
	typeof value === "boolean" ? value : fallback;

function coerce(raw: Record<string, unknown>): ThemeConfig {
	const d = defaultThemeConfig;
	return {
		customLogo: asString(raw.customLogo, d.customLogo),
		customBackgroundImage: asString(
			raw.customBackgroundImage,
			d.customBackgroundImage,
		),
		customMobileBackgroundImage: asString(
			raw.customMobileBackgroundImage,
			d.customMobileBackgroundImage,
		),
		customIllustration: asString(raw.customIllustration, d.customIllustration),
		customLinks: asString(raw.customLinks, d.customLinks),
		customCode: asString(raw.customCode, d.customCode),
		language: asString(raw.language, d.language),
		planTags: asString(raw.planTags, d.planTags),
		// 「备注显示位置」只认那四档；老站点配置里没这个键（或写成别的）→ 两边都摊。
		remarkPlacement: REMARK_PLACEMENTS.includes(
			raw.remarkPlacement as RemarkPlacement,
		)
			? (raw.remarkPlacement as RemarkPlacement)
			: d.remarkPlacement,
		forceTheme: asString(raw.forceTheme, d.forceTheme),
		forceSortType: asString(raw.forceSortType, d.forceSortType),
		forceSortOrder: asString(raw.forceSortOrder, d.forceSortOrder),
		forceShowMap: asBoolean(raw.forceShowMap, d.forceShowMap),
		forceShowServices: asBoolean(raw.forceShowServices, d.forceShowServices),
		forceCardInline: asBoolean(raw.forceCardInline, d.forceCardInline),
		forceUseSvgFlag: asBoolean(raw.forceUseSvgFlag, d.forceUseSvgFlag),
		disableAnimatedMan: asBoolean(raw.disableAnimatedMan, d.disableAnimatedMan),
		forcePeakCutEnabled: asBoolean(
			raw.forcePeakCutEnabled,
			d.forcePeakCutEnabled,
		),
	};
}

let cache: ThemeConfig | null = null;

/**
 * 同步取当前站点配置（还没加载完就是默认值）。给那些**渲染时要用**的纯函数用——
 * 它们没有 await 的机会，而配置早晚会到，第一帧用默认值不影响结论。
 */
export function getThemeConfig(): ThemeConfig {
	return cache ?? defaultThemeConfig;
}
let inflight: Promise<ThemeConfig> | null = null;

/** public/nezha-icon-probe.js 可能在入口包之前就早问过一次设置。 */
type EarlyConfigWindow = { __nezhaThemeConfigPromise?: Promise<unknown> };

/** 读主题配置；接口挂了就退回默认值（页面照常能看，只是没了站点级开关）。 */
export function loadThemeConfig(): Promise<ThemeConfig> {
	if (cache) return Promise.resolve(cache);
	if (inflight) return inflight;
	// 早跑脚本已经问过就接过来用 —— 同一条接口每次加载只该发一条请求。
	const early = (window as unknown as EarlyConfigWindow)
		.__nezhaThemeConfigPromise;
	inflight = (early ?? fetchThemeConfig())
		.then((raw) => {
			cache = coerce(
				raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {},
			);
			return cache;
		})
		.catch(() => {
			cache = { ...defaultThemeConfig };
			return cache;
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

/**
 * 解析「卡片底部标签」规则，算出某台机器要显示的标签。
 *
 * 探针的公开接口没有带宽、也没有 IPv4／IPv6（只有管理端的 ipv4_pin／ipv6_pin），
 * 哪吒那边是站长手写进每台服务器的「公开备注」，所以这里退一步：由站长在主题设置里填规则。
 *
 * ★两个来源（与 jikasei 的「服务器备注 / hub 公开备注」同一套取舍）：
 *   ① **主题设置的「标签规则」匹配到了这台** → 用规则算出来的那几枚芯片（`resolvePlanTags`）；
 *   ② 没匹配到 → 用 **hub 后台按节点填的「公开备注」**（hub ≥ 1.3.2，见 `resolvePlanTagsFor`）。
 * 于是全站标签平时只在后台维护一处，想给某台单独指定带宽/IP 这类结构化标签时再写规则。
 * 每行一条 `匹配 = 标签1,标签2`；匹配按「分组名」或「节点名」子串（包含即命中），`*` 兜底，
 * `#` 开头是注释。标签写 IPv4／IPv6（不区分大小写）走紫／粉芯片，第一个其它标签当带宽（蓝），
 * 其余进灰标签 —— 用的就是上游 PlanInfo 已有的那几种芯片。
 */
/** 规则算出来的结果是不是「什么都没给」（四种芯片全空 = 这台没写规则）。 */
function isEmptyTags(tags: {
	bandwidth: string;
	ipv4: boolean;
	ipv6: boolean;
	extra: string;
}): boolean {
	return !tags.bandwidth && !tags.ipv4 && !tags.ipv6 && !tags.extra;
}

/**
 * hub 的「公开备注」→ 同一套芯片。逗号（半角 / 全角）分隔＝多枚，与主题设置里那份规则的写法
 * 逐字相同（`CN2 GIA,三网优化` 就是两枚）；写法不合规则（没有逗号、认不出 IPv4/IPv6）时
 * 第一枚落进蓝色「带宽」格、其余进灰标签——就是规则里 `* = …` 那一行的渲染结果。
 */
export function tagsFromRemark(remark: string | null | undefined) {
	const labels = String(remark ?? "")
		.split(/[,，]/)
		.map((label) => label.trim())
		.filter(Boolean);
	return labels.length > 0
		? toPlanTags(labels)
		: { bandwidth: "", ipv4: false, ipv6: false, extra: "" };
}

/**
 * 一枚备注小卡片：`own` 为真 = 私有（仅自己可见，版式层用描边 + 锁图标标出来）。
 * 与卡片底部那排**结构化芯片**（带宽 / IPv4 / IPv6 / 灰标签）不是一套东西——那是套餐口径，
 * 这一串是「站长写的备注」，与 jikasei 的 `remarkChips` 同一个口径。
 */
export type RemarkChip = { text: string; own: boolean };

/**
 * 卡片与详情页共用的那一份备注：**私有在前、公有在后**，都按逗号拆成小卡片。
 *
 * 私有那条多一手「按换行也拆」（hub 对它没有单行约束，站长常把几件事分行写）；公开那条 hub
 * 直接拒收换行，拆与不拆是一回事。hub 只把私有备注下发给**登录的管理员**，所以同一个函数在访客
 * 那边拿到的就只有公有那几枚——不需要两套分支，也不会漏泄。
 */
export function remarkChips(node: {
	public_remark?: string | null;
	remark?: string | null;
}): RemarkChip[] {
	const split = (value: string) =>
		value
			.split(/[,，]/)
			.map((t) => t.trim())
			.filter(Boolean);
	const own = String(node.remark ?? "")
		// ★切分认三种行尾（CRLF / LF / 单独的 CR）：hub 不校验这个字段，老数据里带裸 CR 的见过。
		.split(/\r\n|\r|\n/)
		.flatMap(split)
		.map((text) => ({ text, own: true }));
	const pub = split(String(node.public_remark ?? "").trim()).map((text) => ({
		text,
		own: false,
	}));
	return [...own, ...pub];
}

/**
 * 这台机器最终显示的标签：**主题设置的规则优先**，没匹配到才用 hub 的「公开备注」。
 * 两个来源都没有 → 全空（卡片底部那一排整个不渲染）。
 */
export function resolvePlanTagsFor(
	node: {
		name?: string | null;
		group?: string | null;
		public_remark?: string | null;
	},
	/** 规则清单；默认取站点配置那份。留这个参数是为了能脱开网络单测（见 src/test/monitor）。 */
	rules: string = (cache ?? defaultThemeConfig).planTags,
) {
	const own = resolvePlanTags(node, rules);
	return isEmptyTags(own) ? tagsFromRemark(node.public_remark) : own;
}

export function resolvePlanTags(
	node: {
		name?: string | null;
		group?: string | null;
	},
	/** 规则清单；默认取站点配置那份（单测直接喂字符串，不必去桩 fetch）。 */
	rules: string = (cache ?? defaultThemeConfig).planTags,
): {
	bandwidth: string;
	ipv4: boolean;
	ipv6: boolean;
	extra: string;
} {
	const none = { bandwidth: "", ipv4: false, ipv6: false, extra: "" };
	if (!rules) return none;

	let fallback: string[] | null = null;
	for (const line of rules.split("\n")) {
		const text = line.trim();
		if (!text || text.startsWith("#")) continue;
		const eq = text.indexOf("=");
		if (eq < 0) continue;
		const matcher = text.slice(0, eq).trim();
		const labels = text
			.slice(eq + 1)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (!matcher || labels.length === 0) continue;
		if (matcher === "*") {
			fallback = labels;
			continue;
		}
		if (
			String(node.name ?? "").includes(matcher) ||
			String(node.group ?? "").includes(matcher)
		) {
			return toPlanTags(labels);
		}
	}
	return fallback ? toPlanTags(fallback) : none;
}

function toPlanTags(labels: string[]) {
	const ipv4 = labels.some((l) => /^ipv4$/i.test(l));
	const ipv6 = labels.some((l) => /^ipv6$/i.test(l));
	const rest = labels.filter((l) => !/^ipv[46]$/i.test(l));
	return {
		bandwidth: rest[0] ?? "",
		ipv4,
		ipv6,
		extra: rest.slice(1).join(","),
	};
}

/**
 * 把配置写回 window，供上游组件读取。
 *
 * 注意：不要在这里给 Window 加全局类型声明 —— 上游各处用的是
 * `@ts-expect-error 全局变量`，一旦真的声明了属性，那些注释会变成
 * TS2578「未使用的 @ts-expect-error」而编译失败。
 */
export function applyWindowGlobals(cfg: ThemeConfig): void {
	const w = window as unknown as Record<string, unknown>;
	w.CustomLogo = cfg.customLogo || defaultThemeConfig.customLogo;
	w.CustomBackgroundImage = cfg.customBackgroundImage;
	w.CustomMobileBackgroundImage = cfg.customMobileBackgroundImage;
	w.CustomIllustration = cfg.customIllustration;
	w.CustomLinks = cfg.customLinks;
	w.ForceTheme = cfg.forceTheme;
	w.ForceShowMap = cfg.forceShowMap;
	w.ForceShowServices = cfg.forceShowServices;
	w.ForceCardInline = cfg.forceCardInline;
	// 卡片形态固定为「名称置顶 + 显示周期流量」，不再提供开关
	w.ShowNetTransfer = true;
	w.ForceUseSvgFlag = cfg.forceUseSvgFlag;
	w.FixedTopServerName = true;
	w.DisableAnimatedMan = cfg.disableAnimatedMan;
	w.ForcePeakCutEnabled = cfg.forcePeakCutEnabled;
	// 排序项未设置时保持 undefined：sort-provider 就是按「有值才强制」来判断的
	w.ForceSortType = cfg.forceSortType || undefined;
	w.ForceSortOrder = cfg.forceSortOrder || undefined;
}
