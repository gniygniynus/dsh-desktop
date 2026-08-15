// zstd 帧工具：与 harness（dsh-session-persistence-jsonl）同款算法
// - scanZstdFrames：定位完整帧（算法对齐自 harness，MIT）
// - sessionFileToText：逐帧解压拼接成完整 JSONL 文本
// - throwableText + buildZstdFile：head 帧 + 事件帧 重建 harness 兼容文件
import { readFileSync } from "node:fs";
import { zstdCompressSync, zstdDecompressSync, constants as ZC } from "node:zlib";

const ZSTD_MAGIC = 4247762216; // 0x28B52FFD
const CHECKSUMED = { params: { [ZC.ZSTD_c_checksumFlag]: 1 } };

/** 定位完整帧区间；尾巴允许半帧（tornStart）。算法对齐 harness scanZstdFrames。 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`corrupt zstd: bad magic @${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`corrupt zstd: reserved bit @${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`corrupt zstd: reserved block @${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

function decompressFrame(slice) {
  return zstdDecompressSync(slice).toString("utf8");
}

/** 读 harness 会话文件 → 完整 JSONL 文本（仅完整帧；torn 尾丢弃）。 */
export function sessionFileToText(path) {
  const buf = readFileSync(path);
  const { frames } = scanZstdFrames(buf);
  if (frames.length === 0) throw new Error("会话文件无完整帧: " + path);
  let out = "";
  for (const f of frames) out += decompressFrame(buf.subarray(f.start, f.end));
  return out;
}

/** 压缩一帧（带校验，harness 兼容）。 */
export function compressFrame(text) {
  return zstdCompressSync(Buffer.from(text, "utf8"), CHECKSUMED);
}

/** 重建会话文件字节：headerLine 独占一帧，其余事件合为一帧。 */
export function buildZstdFile(headerLine, eventsText) {
  const head = compressFrame(headerLine.endsWith("\n") ? headerLine : headerLine + "\n");
  const body = compressFrame(eventsText.length ? eventsText : "");
  return Buffer.concat([head, body]);
}