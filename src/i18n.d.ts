/**
 * 上游保留的 `src/i18n.js` 没有类型声明。这里给它补一份**最小**声明（只声明外部用到的那部分），
 * 免得每个使用点都要写 `@ts-expect-error`。
 */
declare const i18n: import("i18next").i18n;

/** 把某个语言的词条补进来（按需加载，见 src/i18n.js）。 */
export declare function ensureLocale(lng?: string): Promise<void>;

export default i18n;
