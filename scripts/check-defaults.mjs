// 校验 theme.json 的默认值与 src/monitor/config.ts 的内置默认值是否一致。
//
// 为什么必须一致：后台「主题设置」面板显示的是 theme.json 的 default，
// 但配置为空（新装 / 保存失败 / 用户没动过）时页面实际用的是 config.ts 的 defaultThemeConfig。
// 两处不同步就会出现「面板显示已开启、页面却还是旧形态」这种极难排查的现象（1.0.6 踩过）。
import { readFileSync } from "node:fs";

const theme = JSON.parse(readFileSync("theme.json", "utf8"));
const cfgSrc = readFileSync("src/monitor/config.ts", "utf8");

const fromTheme = new Map();
for (const item of theme.config ?? []) {
	if (!item.key || !("default" in item)) continue;
	fromTheme.set(item.key, item.default);
}

const start = cfgSrc.indexOf("defaultThemeConfig");
if (start < 0) throw new Error("config.ts 里找不到 defaultThemeConfig");
const body = cfgSrc.slice(start, cfgSrc.indexOf("};", start));
const fromCode = new Map();
for (const line of body.split("\n")) {
	const m = /^\s*([A-Za-z_][\w]*)\s*:\s*(.+?),\s*$/.exec(line);
	if (!m) continue;
	let value = m[2].trim();
	if (value === "true") value = true;
	else if (value === "false") value = false;
	else if (/^".*"$/.test(value)) value = value.slice(1, -1);
	fromCode.set(m[1], value);
}

const problems = [];
for (const [key, themeValue] of fromTheme) {
	if (!fromCode.has(key)) {
		problems.push(
			`${key}: config.ts 缺少默认值（theme.json=${JSON.stringify(themeValue)}）`,
		);
		continue;
	}
	const codeValue = fromCode.get(key);
	if (codeValue !== themeValue) {
		problems.push(
			`${key}: theme.json=${JSON.stringify(themeValue)} ≠ config.ts=${JSON.stringify(codeValue)}`,
		);
	}
}
for (const key of fromCode.keys()) {
	if (!fromTheme.has(key)) {
		problems.push(
			`${key}: theme.json 缺少配置项（config.ts=${JSON.stringify(fromCode.get(key))}）`,
		);
	}
}
if (problems.length) {
	throw new Error(
		`theme.json 与 config.ts 的默认值不一致：\n  - ${problems.join("\n  - ")}`,
	);
}
console.log(
	`  ✔ 默认值一致（theme.json ${fromTheme.size} 项 / config.ts ${fromCode.size} 项）`,
);
