import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import deTranslation from "./locales/de/translation.json";
import enTranslation from "./locales/en/translation.json";
import esTranslation from "./locales/es/translation.json";
import frTranslation from "./locales/fr/translation.json";
import glTranslation from "./locales/gl/translation.json";
import idTranslation from "./locales/id/translation.json";
import jaTranslation from "./locales/ja/translation.json";
import ptBRTranslation from "./locales/pt_BR/translation.json";
import roTranslation from "./locales/ro/translation.json";
import ruTranslation from "./locales/ru/translation.json";
import taTranslation from "./locales/ta/translation.json";
import ukTranslation from "./locales/uk/translation.json";
import zhCNTranslation from "./locales/zh-CN/translation.json";
import zhTWTranslation from "./locales/zh-TW/translation.json";

const resources = {
	"en-US": {
		translation: enTranslation,
	},
	"zh-CN": {
		translation: zhCNTranslation,
	},
	"zh-TW": {
		translation: zhTWTranslation,
	},
	"de-DE": {
		translation: deTranslation,
	},
	"es-ES": {
		translation: esTranslation,
	},
	fr: {
		translation: frTranslation,
	},
	gl: {
		translation: glTranslation,
	},
	id: {
		translation: idTranslation,
	},
	ja: {
		translation: jaTranslation,
	},
	pt_BR: {
		translation: ptBRTranslation,
	},
	ro: {
		translation: roTranslation,
	},
	"ru-RU": {
		translation: ruTranslation,
	},
	"ta-IN": {
		translation: taTranslation,
	},
	uk: {
		translation: ukTranslation,
	},
};

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
	resources,
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
