// 把国旗与系统 logo 的字形/样式从依赖里搬到 public/，让主题包自带这些资源。
//
// 上游是运行时从 jsdelivr 拉的（index.html 里两条 <link>）：换到自建的探针上
// 一旦 CDN 不可达，国旗和系统图标就整片消失。搬进包里就没这个问题。
// 只搬 4x3 一套国旗（上游只用 `fi fi-xx`，从不使用方形 `fis`）。
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const VENDOR = "public/vendor";

mkdirSync(VENDOR, { recursive: true });

// 1) 国旗 SVG：整目录替换（只有这一份来源）
const flagsFrom = "node_modules/flag-icons/flags/4x3";
const flagsTo = "public/flags/4x3";
if (!existsSync(flagsFrom)) {
	console.error(`缺少 ${flagsFrom}，先跑 pnpm install`);
	process.exit(1);
}
rmSync(flagsTo, { recursive: true, force: true });
cpSync(flagsFrom, flagsTo, { recursive: true });
console.log(`vendored ${flagsFrom} -> ${flagsTo}`);

// 2) flag-icons 的样式：单个文件覆盖。
//    注意：别再对 public/vendor 整个目录 rmSync —— 会把刚拷进来的样式一起删掉。
const cssFrom = "node_modules/flag-icons/css/flag-icons.min.css";
const cssTo = join(VENDOR, "flag-icons.min.css");
if (!existsSync(cssFrom)) {
	console.error(`缺少 ${cssFrom}，先跑 pnpm install`);
	process.exit(1);
}
copyFileSync(cssFrom, cssTo);
console.log(`vendored ${cssFrom} -> ${cssTo}`);

/**
 * 把 @font-face 的 src 按「谁更省」重排：woff2(27KB) 优先于 woff(108KB) 与 ttf(48KB)。
 *
 * 上游 font-logos.css 把 woff 写在最前面，而浏览器挑的是**第一个自己支持的格式** ——
 * 于是每个现代浏览器都白下 108KB 的 woff，那份 27KB 的 woff2 一次都不碰（实测见
 * tools/audit_home_requests.mjs 的请求计数：/vendor/font-logos.woff 1 次、woff2 0 次）。
 */
const FORMAT_RANK = { woff2: 0, woff: 1, truetype: 2 };

function preferModernFormats(css) {
	return css.replace(/src:([^;}]+)/g, (whole, body) => {
		const entries = body
			.split(/,(?=\s*url\()/)
			.map((entry) => entry.trim())
			.filter(Boolean);
		if (entries.length < 2) return whole;
		const rankOf = (entry) => {
			const format = /format\("([^"]+)"\)/.exec(entry);
			return format ? (FORMAT_RANK[format[1]] ?? 9) : 9;
		};
		const sorted = [...entries].sort((a, b) => rankOf(a) - rankOf(b));
		if (sorted.join(",") === entries.join(",")) return whole;
		return `src:${sorted.join(",")}`;
	});
}

// 3) font-logos 的字形与样式：逐文件拷贝，不动目录里的其他东西
const fontFrom = "node_modules/font-logos/assets";
const fontFiles = [
	"font-logos.css",
	"font-logos.woff",
	"font-logos.woff2",
	"font-logos.ttf",
];
if (!existsSync(fontFrom)) {
	console.error(`缺少 ${fontFrom}，先跑 pnpm install`);
	process.exit(1);
}
for (const file of fontFiles) {
	copyFileSync(join(fontFrom, file), join(VENDOR, file));
}

const fontCssPath = join(VENDOR, "font-logos.css");
const fontCssRaw = readFileSync(fontCssPath, "utf8");
const fontCss = preferModernFormats(fontCssRaw);
const isOrdered = (css) => {
	const order = /src:([^;}]+)/.exec(css)?.[1] ?? "";
	return (
		order.indexOf('format("woff2")') >= 0 &&
		order.indexOf('format("woff2")') < order.indexOf('format("woff")')
	);
};
if (fontCss === fontCssRaw && !isOrdered(fontCssRaw)) {
	// 没改动、又不是 woff2 优先 → 重排逻辑失效了（真出了这事就是每个访客白下 108KB 的 woff）
	throw new Error(
		`font-logos.css 的 src 重排没生效，先看看写法是不是变了：${fontCssRaw.slice(0, 400)}`,
	);
}
// 护栏：写出去的那份里 woff2 必须排在 woff 前面（顺序错了就是 81KB 白流量）
if (!isOrdered(fontCss)) {
	throw new Error(
		`font-logos.css 重排后 woff2 仍没排在 woff 前面：${/src:([^;}]+)/.exec(fontCss)?.[1]}`,
	);
}
if (fontCss !== fontCssRaw) {
	writeFileSync(fontCssPath, fontCss);
	console.log(`重新排序 ${fontCssPath} 的 @font-face src（woff2 优先）`);
} else {
	console.log(`  ${fontCssPath} 的 src 已经是 woff2 优先，没动它`);
}
console.log(`vendored ${fontFrom} -> ${VENDOR}（${fontFiles.length} 个文件）`);
