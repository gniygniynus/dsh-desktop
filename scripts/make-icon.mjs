// 用 harness 自带的 DeepSeek 官方 favicon.svg 生成应用图标 build/icon.ico（多尺寸）。
// favicon.svg 是单色（黑/白随主题），这里把鲸鱼 fill 成 DeepSeek 品牌蓝，更适合做应用图标。
// 用法：node scripts/make-icon.mjs [颜色hex，默认 #4D6BFE]
import sharp from "sharp";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const SRC = "node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg";
const COLOR = (process.argv[2] || "#4D6BFE").replace(/^#/, "");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// 读 SVG 并把 path 的 fill 换成目标色（原 favicon 是 fill="#000" / 暗色 fill="#fff"）
let svg = readFileSync(SRC, "utf8");
svg = svg.replace(/fill="#000"/g, `fill="#${COLOR}"`).replace(/fill="#fff"/g, `fill="#${COLOR}"`);

const pngs = [];
for (const size of SIZES) {
  pngs.push(await sharp(Buffer.from(svg), { density: 512 }).resize(size, size).png().toBuffer());
}

// 编码多尺寸 ICO（内嵌 PNG，Windows 直接识别）
const count = pngs.length;
const headerSize = 6 + count * 16;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(count, 4); // count
let offset = headerSize;
for (let i = 0; i < count; i++) {
  const size = SIZES[i];
  const entry = 6 + i * 16;
  header.writeUInt8(size === 256 ? 0 : size, entry + 0); // width（256 记作 0）
  header.writeUInt8(size === 256 ? 0 : size, entry + 1); // height
  header.writeUInt8(0, entry + 2); // palette
  header.writeUInt8(0, entry + 3); // reserved
  header.writeUInt16LE(1, entry + 4); // planes
  header.writeUInt16LE(32, entry + 6); // bpp
  header.writeUInt32LE(pngs[i].length, entry + 8); // size
  header.writeUInt32LE(offset, entry + 12); // offset
  offset += pngs[i].length;
}
const ico = Buffer.concat([header, ...pngs]);

mkdirSync("build", { recursive: true });
writeFileSync("build/icon.ico", ico);
console.log(`[make-icon] 已生成 build/icon.ico（尺寸 ${SIZES.join("/")}，颜色 #${COLOR}）`);
