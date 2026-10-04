// theme.json 的「面板能不能画出来」护栏。
//
// 为什么要有它：hub 的主题设置面板是照 theme.json 的 config 数组直接画的，有几条**静默失败**的
// 规则（画不出来不报错、站长只会觉得「这项设置不见了」）：
//   · 标题（type: "title"）只有在**后面跟着字段**时才会画出来 —— 两个标题挨着，前一个被丢掉；
//   · 结尾孤零零一个标题同样不画；
//   · select 的 default 不在 options 里 → 面板里选中项是空的。
// 另外把「url 与仓库名一致」也钉上：改过仓库名之后忘了同步 theme.json，hub 的「从 GitHub 更新」
// 就会指向一个已经不存在的地址（旧地址虽然会 302，但那是 GitHub 的宽容，不是我们的正确）。
//
// 用法: node scripts/check-manifest.mjs
import { readFileSync } from "node:fs";

const theme = JSON.parse(readFileSync("theme.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const problems = [];
const fail = (message) => problems.push(message);

// ── 头部字段 ────────────────────────────────────────────────────────────────
for (const key of [
	"name",
	"short",
	"description",
	"version",
	"author",
	"url",
]) {
	if (typeof theme[key] !== "string" || !theme[key].trim())
		fail(`theme.json 缺少 ${key}`);
}
if (!/^[A-Za-z0-9_-]+$/.test(theme.short || ""))
	fail(`short 只能是字母数字下划线连字符：${theme.short}`);
if (theme.version !== pkg.version)
	fail(
		`theme.json 的 version（${theme.version}）与 package.json（${pkg.version}）不一致`,
	);
if (!String(theme.url || "").endsWith(`/${pkg.name}`))
	fail(
		`url（${theme.url}）与 package.json 的 name（${pkg.name}）对不上 —— 改过仓库名？`,
	);

// ── config 数组 ─────────────────────────────────────────────────────────────
const config = theme.config;
if (!Array.isArray(config) || config.length === 0)
	fail("config 必须是数组且非空");

const fields = [];
const titles = [];
config.forEach((item, index) => {
	const next = config[index + 1];
	if (item.type === "title") {
		if (!item.label) fail(`第 ${index} 项的标题没有 label`);
		// hub 只画「后面跟着字段」的标题
		if (!next)
			fail(`最后一个标题「${item.label}」后面没有字段 —— 面板里不会画出来`);
		else if (next.type === "title")
			fail(
				`两个标题挨着：「${item.label}」与「${next.label}」—— 前一个会被静默丢掉`,
			);
		titles.push(item.label);
		return;
	}
	fields.push(item);
	for (const key of ["key", "label"]) {
		if (typeof item[key] !== "string" || !item[key].trim())
			fail(`第 ${index} 项（${item.label ?? item.key}）缺少 ${key}`);
	}
	if (typeof item.help !== "string" || !item.help.trim())
		fail(`「${item.label}」没有 help —— 面板里那行灰字是站长唯一的说明书`);
	if (!["string", "text", "boolean", "select", "number"].includes(item.type))
		fail(`「${item.label}」的 type 不认识：${item.type}`);
	if (!Object.hasOwn(item, "default"))
		fail(`「${item.label}」没有 default —— 面板里的初值会是空的`);
	if (item.type === "boolean" && typeof item.default !== "boolean")
		fail(
			`「${item.label}」是布尔项，default 却不是布尔值：${JSON.stringify(item.default)}`,
		);
	if (item.type === "select") {
		const values = (item.options ?? []).map((option) => option.value);
		if (values.length < 2) fail(`「${item.label}」是下拉项，options 少于两个`);
		if (!values.includes(item.default))
			fail(
				`「${item.label}」的 default（${JSON.stringify(item.default)}）不在 options 里`,
			);
		for (const option of item.options ?? []) {
			if (typeof option.label !== "string" || !option.label.trim())
				fail(
					`「${item.label}」有一个选项没有 label：${JSON.stringify(option.value)}`,
				);
		}
	}
});

const keys = fields.map((field) => field.key);
const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
if (duplicates.length > 0)
	fail(`字段 key 重复：${[...new Set(duplicates)].join(" ")}`);

// ── 报告 ────────────────────────────────────────────────────────────────────
console.log(
	`theme.json：${theme.name} ${theme.version}（short=${theme.short}）｜${titles.length} 个分组 / ${fields.length} 个设置项`,
);
console.log(`  分组：${titles.join(" / ")}`);
console.log(`  url：${theme.url}`);
if (problems.length > 0) {
	console.error(`\n✖ theme.json 有 ${problems.length} 处问题：`);
	for (const problem of problems) console.error(`  · ${problem}`);
	process.exit(1);
}
console.log("  ✔ 面板结构、默认值与 url 都没问题");
