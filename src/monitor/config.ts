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
		customBackgroundImage: asString(raw.customBackgroundImage, d.customBackgroundImage),
		customMobileBackgroundImage: asString(
			raw.customMobileBackgroundImage,
			d.customMobileBackgroundImage,
		),
		customIllustration: asString(raw.customIllustration, d.customIllustration),
		customLinks: asString(raw.customLinks, d.customLinks),
		customCode: asString(raw.customCode, d.customCode),
		language: asString(raw.language, d.language),
		planTags: asString(raw.planTags, d.planTags),
		forceTheme: asString(raw.forceTheme, d.forceTheme),
		forceSortType: asString(raw.forceSortType, d.forceSortType),
		forceSortOrder: asString(raw.forceSortOrder, d.forceSortOrder),
		forceShowMap: asBoolean(raw.forceShowMap, d.forceShowMap),
		forceShowServices: asBoolean(raw.forceShowServices, d.forceShowServices),
		forceCardInline: asBoolean(raw.forceCardInline, d.forceCardInline),
		forceUseSvgFlag: asBoolean(raw.forceUseSvgFlag, d.forceUseSvgFlag),
		disableAnimatedMan: asBoolean(raw.disableAnimatedMan, d.disableAnimatedMan),
		forcePeakCutEnabled: asBoolean(raw.forcePeakCutEnabled, d.forcePeakCutEnabled),
	};
}

let cache: ThemeConfig | null = null;
let inflight: Promise<ThemeConfig> | null = null;

/** public/nezha-icon-probe.js 可能在入口包之前就早问过一次设置。 */
type EarlyConfigWindow = { __nezhaThemeConfigPromise?: Promise<unknown> };

/** 读主题配置；接口挂了就退回默认值（页面照常能看，只是没了站点级开关）。 */
export function loadThemeConfig(): Promise<ThemeConfig> {
	if (cache) return Promise.resolve(cache);
	if (inflight) return inflight;
	// 早跑脚本已经问过就接过来用 —— 同一条接口每次加载只该发一条请求。
	const early = (window as unknown as EarlyConfigWindow).__nezhaThemeConfigPromise;
	inflight = (early ?? fetchThemeConfig())
		.then((raw) => {
			cache = coerce(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
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
 * 每行一条 `匹配 = 标签1,标签2`；匹配按「分组名」或「节点名」子串（包含即命中），`*` 兜底，
 * `#` 开头是注释。标签写 IPv4／IPv6（不区分大小写）走紫／粉芯片，第一个其它标签当带宽（蓝），
 * 其余进灰标签 —— 用的就是上游 PlanInfo 已有的那几种芯片。
 */
export function resolvePlanTags(node: { name?: string | null; group?: string | null }): {
	bandwidth: string;
	ipv4: boolean;
	ipv6: boolean;
	extra: string;
} {
	const none = { bandwidth: "", ipv4: false, ipv6: false, extra: "" };
	const rules = (cache ?? defaultThemeConfig).planTags;
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
		if (String(node.name ?? "").includes(matcher) || String(node.group ?? "").includes(matcher)) {
			return toPlanTags(labels);
		}
	}
	return fallback ? toPlanTags(fallback) : none;
}

function toPlanTags(labels: string[]) {
	const ipv4 = labels.some((l) => /^ipv4$/i.test(l));
	const ipv6 = labels.some((l) => /^ipv6$/i.test(l));
	const rest = labels.filter((l) => !/^ipv[46]$/i.test(l));
	return { bandwidth: rest[0] ?? "", ipv4, ipv6, extra: rest.slice(1).join(",") };
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
