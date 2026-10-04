import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslation from "./locales/en/translation.json";
import zhCNTranslation from "./locales/zh-CN/translation.json";

/**
 * 词条只把**默认语言（简体中文）与兜底语言（英语）**打进入口包，其余 12 种按需拉一个几 KB 的 chunk。
 *
 * 为什么：14 份 translation.json 合计约 50KB（未压缩），原先全部静态 import 进 index.js
 * —— 实测入口包 137KB 里有三分之一是词条，而访客一次只会看一种语言。
 *
 * 谁在什么时候拉：
 * - 首屏：main.tsx 的 boot() 在挂载 React **之前** `await ensureLocale(当前语言)`，
 *   所以不会出现「先显示英文、再跳成中文」；
 * - 页头切换语言：LanguageSwitcher 先 `await ensureLocale(新语言)` 再 changeLanguage。
 */
const STATIC = {
	"en-US": { translation: enTranslation },
	"zh-CN": { translation: zhCNTranslation },
};

/** 语言键 → 加载器。键必须与 theme.json「站点默认语言」的选项、页头那排一一对应。 */
const LAZY = {
	"zh-TW": () => import("./locales/zh-TW/translation.json"),
	"ru-RU": () => import("./locales/ru/translation.json"),
	"es-ES": () => import("./locales/es/translation.json"),
	"de-DE": () => import("./locales/de/translation.json"),
	"ta-IN": () => import("./locales/ta/translation.json"),
	fr: () => import("./locales/fr/translation.json"),
	gl: () => import("./locales/gl/translation.json"),
	id: () => import("./locales/id/translation.json"),
	ja: () => import("./locales/ja/translation.json"),
	pt_BR: () => import("./locales/pt_BR/translation.json"),
	ro: () => import("./locales/ro/translation.json"),
	uk: () => import("./locales/uk/translation.json"),
};

const ALL_KEYS = [...Object.keys(STATIC), ...Object.keys(LAZY)];

/**
 * 把 i18next 可能给出的写法收敛到我们的键：`pt-BR` ↔ `pt_BR`、大小写不同、
 * 只给了主语言（`zh-Hans` / `de-AT`）时退到该主语言的第一种。认不出来返回空串。
 */
function normalizeLocale(lng) {
	const raw = String(lng || "").trim();
	if (!raw) return "";
	for (const candidate of [
		raw,
		raw.replace(/_/g, "-"),
		raw.replace(/-/g, "_"),
	]) {
		if (ALL_KEYS.includes(candidate)) return candidate;
	}
	const lower = raw.toLowerCase();
	const exact = ALL_KEYS.find((key) => key.toLowerCase() === lower);
	if (exact) return exact;
	const base = lower.split(/[-_]/)[0];
	return (
		ALL_KEYS.find((key) => key.toLowerCase().split(/[-_]/)[0] === base) ?? ""
	);
}

const pending = new Map();

/**
 * 把某个语言的词条补进来。已经在包里（zh-CN / en-US）或已经拉过 → 立刻返回；
 * 拉不到不抛错（退回兜底语言），也**不缓存失败**（下次再试）。
 */
export async function ensureLocale(lng) {
	const key = normalizeLocale(lng);
	if (!key) return;
	if (i18n.hasResourceBundle(key, "translation")) return;
	const load = LAZY[key];
	if (!load) return;
	if (!pending.has(key)) {
		pending.set(
			key,
			load()
				.then((mod) => {
					i18n.addResourceBundle(
						key,
						"translation",
						mod.default ?? mod,
						true,
						true,
					);
				})
				.catch(() => {
					// 拉不到就让它显示兜底语言（en-US 在包里），不把页面拦住。
				})
				.finally(() => {
					pending.delete(key);
				}),
		);
	}
	return pending.get(key);
}

const getStoredLanguage = () => {
	return localStorage.getItem("language") || "en-US";
};

/**
 * 让 <html lang> 跟着界面语言走。
 *
 * 为什么必须：`index.html` 里写死的是 `lang="en"`，而站长把默认语言设成简体中文之后
 * 页面正文全是中文、语言标记却还是 en —— 读屏软件会按英语朗读、浏览器翻译会判定
 * 「已经是英语了」而不提供翻译、搜索引擎也会按英语索引。
 * 顺带把 i18next 的 `pt_BR` 这类写法归一成 BCP-47 的 `pt-BR`。
 */
const applyHtmlLang = (lng) => {
	if (typeof document === "undefined" || !document.documentElement) return;
	const tag = String(lng || "").replace(/_/g, "-");
	if (tag) document.documentElement.lang = tag;
};

i18n.use(initReactI18next).init({
	resources: STATIC,
	lng: getStoredLanguage(), // 使用localStorage中存储的语言或默认值
	fallbackLng: "en-US", // 当前语言的翻译没有找到时，使用的备选语言
	interpolation: {
		escapeValue: false, // react已经安全地转义
	},
});

applyHtmlLang(i18n.language);

// 添加语言改变时的处理函数
i18n.on("languageChanged", (lng) => {
	localStorage.setItem("language", lng);
	applyHtmlLang(lng);
});

export default i18n;
