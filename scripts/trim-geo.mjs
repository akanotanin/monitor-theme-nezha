// 重新生成 src/lib/geo-json-string.ts：从上游那份完整的世界轮廓 GeoJSON 里
// 只留下 GlobalMap 真正读的三个属性，几何坐标一字不动。
//
// 为什么：上游那份 965KB 的字符串带了 169 个属性（pop_est / gdp_md / mapcolor* /
// fclass_xx …），GlobalMap 只读 iso_a2_eh、iso_a3_eh、name。裁掉没人读的属性 = 少下 553KB。
//
// 用法：
//   node scripts/trim-geo.mjs                     # 从上游仓库拉基线版本（需能访问 github）
//   node scripts/trim-geo.mjs <本地文件路径>       # 用本地那份（例：git show 出来的旧版本）
//   GEO_REF=<commit|tag> node scripts/trim-geo.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const REF = process.env.GEO_REF || "cd070d5"; // 本移植项目的上游基线（v2.4.3）
const URL = `https://raw.githubusercontent.com/hamster1963/nezha-dash-v2/${REF}/src/lib/geo-json-string.ts`;
const OUT = "src/lib/geo-json-string.ts";

/** 只留这三个：GlobalMap 里分别用于高亮、过滤空 ISO、tooltip 的国家名。 */
const KEEP = ["iso_a2_eh", "iso_a3_eh", "name"];

const gz = (s) => {
	try {
		return gzipSync(Buffer.from(s), { level: 9 }).length;
	} catch {
		return 0;
	}
};

const arg = process.argv[2];
let raw;
if (arg) {
	raw = readFileSync(arg, "utf8");
	console.log(`读本地：${arg}`);
} else {
	console.log(`拉上游：${URL}`);
	const res = await fetch(URL);
	if (!res.ok)
		throw new Error(
			`拉不到上游：HTTP ${res.status}（github 直连不通时先挂代理）`,
		);
	raw = await res.text();
}

const body = raw.slice(raw.indexOf("`") + 1, raw.lastIndexOf("`"));
const geo = JSON.parse(body);
if (geo.type !== "FeatureCollection" || !Array.isArray(geo.features)) {
	throw new Error("上游不是 FeatureCollection，先看看文件格式是不是变了");
}

const trimmed = {
	type: geo.type,
	features: geo.features.map((f) => ({
		type: f.type,
		properties: Object.fromEntries(
			KEEP.filter((k) => k in f.properties).map((k) => [k, f.properties[k]]),
		),
		geometry: f.geometry,
	})),
};

// 逐条断言：几何与三个关键属性必须与上游一模一样，否则宁可报错也别写出个坏数据。
if (trimmed.features.length !== geo.features.length)
	throw new Error("feature 数量变了");
for (let i = 0; i < geo.features.length; i++) {
	const a = geo.features[i];
	const b = trimmed.features[i];
	if (JSON.stringify(a.geometry) !== JSON.stringify(b.geometry)) {
		throw new Error(`第 ${i} 条几何不一致（${a.properties?.name}）`);
	}
	for (const k of KEEP) {
		if (a.properties[k] !== b.properties[k]) {
			throw new Error(`第 ${i} 条的 ${k} 不一致`);
		}
	}
	if (!(KEEP[0] in b.properties) || !(KEEP[1] in b.properties)) {
		throw new Error(`第 ${i} 条缺 iso 代码（${a.properties?.name}）`);
	}
}
const json = JSON.stringify(trimmed);
if (json.includes("`") || json.includes("${")) {
	throw new Error("数据里出现了模板字符串的保留字符，不能直接写进反引号");
}

const out = `/**
 * 世界轮廓 GeoJSON（\`FeatureCollection\`），供 GlobalMap 画地图用。
 *
 * ★ 生成物，别手改：用 \`node scripts/trim-geo.mjs\` 重新生成
 * （源：hamster1963/nezha-dash-v2 @ ${REF} 的 src/lib/geo-json-string.ts）。
 *
 * 上游那份带了 169 个属性（pop_est / gdp_md / mapcolor* / fclass_xx …），而地图只读
 * iso_a2_eh（高亮）、iso_a3_eh（过滤空 ISO）、name（tooltip）；其余属性没人读，
 * 却要跟着主题包走、还要在访客首屏被下载和 JSON.parse。生成时逐条断言过
 * 「几何 + 这三个属性与上游完全一致」，只删属性、不动坐标。
 */
export const geoJsonString = \`${json}\`;
`;

writeFileSync(OUT, out);
console.log(`写好 ${OUT}`);
console.log(
	`  feature ${geo.features.length} 条（不变）、属性键 169 → ${KEEP.length}\n` +
		`  字符串 ${body.length} → ${json.length} 字符（-${Math.round((1 - json.length / body.length) * 100)}%）\n` +
		`  文件 ${raw.length} → ${out.length} 字节，gzip ${gz(raw)} → ${gz(out)}`,
);
