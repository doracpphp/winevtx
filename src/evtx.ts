import type {
  ChunkRef} from "./parse-context.js";
import {
  ParseContext,
  filetimeToUnixtime,
  mapToObject,
} from "./parse-context.js";
import { parseBinXML } from "./binxml.js";

const EVTX_HEADER_MAGIC = "ElfFile\x00";
const EVTX_CHUNK_HEADER_MAGIC = "ElfChnk\x00";
const EVTX_CHUNK_HEADER_SIZE = 0x200;
const EVTX_CHUNK_SIZE = 0x10000; // 64KB
const EVTX_EVENT_RECORD_MAGIC = "\x2a\x2a\x00\x00";
const EVTX_EVENT_RECORD_SIZE = 24;
const EVTX_FILE_HEADER_SIZE = 128;

// --- Header structs ---

interface EVTXHeader {
  magic: string;
  firstChunk: bigint;
  lastChunk: bigint;
  nextRecordID: bigint;
  headerSize: number;
  minorVersion: number;
  majorVersion: number;
  headerBlockSize: number;
  chunkCount: number;
  fileFlags: number;
  checkSum: number;
}

function parseEVTXHeader(buf: Buffer): EVTXHeader {
  return {
    magic: buf.subarray(0, 8).toString("ascii"),
    firstChunk: buf.readBigUInt64LE(8),
    lastChunk: buf.readBigUInt64LE(16),
    nextRecordID: buf.readBigUInt64LE(24),
    headerSize: buf.readUInt32LE(32),
    minorVersion: buf.readUInt16LE(36),
    majorVersion: buf.readUInt16LE(38),
    headerBlockSize: buf.readUInt16LE(40),
    chunkCount: buf.readUInt16LE(42),
    fileFlags: buf.readUInt32LE(120),
    checkSum: buf.readUInt32LE(124),
  };
}

interface ChunkHeader {
  magic: string;
  firstEventRecNumber: bigint;
  lastEventRecNumber: bigint;
  firstEventRecID: bigint;
  lastEventRecID: bigint;
  headerSize: number;
  lastEventRecOffset: number;
  eventRecordCheckSum: number;
  checkSum: number;
}

function parseChunkHeader(buf: Buffer): ChunkHeader {
  return {
    magic: buf.subarray(0, 8).toString("ascii"),
    firstEventRecNumber: buf.readBigUInt64LE(8),
    lastEventRecNumber: buf.readBigUInt64LE(16),
    firstEventRecID: buf.readBigUInt64LE(24),
    lastEventRecID: buf.readBigUInt64LE(32),
    headerSize: buf.readUInt32LE(40),
    lastEventRecOffset: buf.readUInt32LE(44),
    eventRecordCheckSum: buf.readUInt32LE(52),
    checkSum: buf.readUInt32LE(124),
  };
}

interface EventRecordHeader {
  magic: string;
  size: number;
  recordID: bigint;
  fileTime: bigint;
}

function readEventRecordHeader(
  buf: Buffer,
  offset: number
): EventRecordHeader {
  return {
    magic: buf.subarray(offset, offset + 4).toString("binary"),
    size: buf.readUInt32LE(offset + 4),
    recordID: buf.readBigUInt64LE(offset + 8),
    fileTime: buf.readBigUInt64LE(offset + 16),
  };
}

export interface EventRecord {
  header: EventRecordHeader;
  event: unknown;
}

/** Abstraction for random-access reads. Implementations can back this with
 *  node:fs, browser File.slice(), or a plain Buffer. */
export interface DataSource {
  /** Total size in bytes. */
  size: number;
  /** Read `size` bytes starting at `offset`. */
  readAt(offset: number, size: number): Promise<Buffer>;
}

/** Wrap a Buffer as a DataSource (zero-copy, for small files / tests). */
export function bufferDataSource(buf: Buffer): DataSource {
  return {
    size: buf.length,
    readAt(offset: number, size: number): Promise<Buffer> {
      return Promise.resolve(buf.subarray(offset, offset + size));
    },
  };
}

export interface ChunkInfo {
  index: number;
  offset: number;
  header: ChunkHeader;
}

export interface ParsedRecord {
  recordID: number;
  timestamp: number;
  event: unknown;
}

// --- Low-level I/O helpers ---

/** Validate a header buffer that has already been read. */
function validateFileHeader(buf: Buffer): EVTXHeader {
  if (buf.length < EVTX_FILE_HEADER_SIZE) {
    throw new Error("File too small to be an EVTX file");
  }
  const header = parseEVTXHeader(buf);
  if (header.magic !== EVTX_HEADER_MAGIC) {
    throw new Error("File is not an EVTX file (wrong magic).");
  }
  if (!isSupported(header.minorVersion, header.majorVersion)) {
    throw new Error(
      `Unsupported EVTX version: ${header.majorVersion}.${header.minorVersion}`
    );
  }
  return header;
}

function isSupported(minor: number, major: number): boolean {
  if (major === 3) {
    return minor === 0 || minor === 1 || minor === 2;
  }
  return false;
}

// --- Chunk-level helpers ---

/** Validate a chunk buffer and parse its header. Returns null if invalid. */
function validateChunk(
  buf: Buffer
): { header: ChunkHeader; buf: Buffer } | null {
  if (buf.length < EVTX_CHUNK_HEADER_SIZE) {
    return null;
  }

  const header = parseChunkHeader(buf);
  if (header.magic !== EVTX_CHUNK_HEADER_MAGIC) {
    return null;
  }
  if (header.lastEventRecID === 0xffffffffffffffffn) {
    return null;
  }

  return { header, buf };
}

// --- Record parsing from a chunk buffer ---

interface Chunk extends ChunkRef {
  header: ChunkHeader;
  offset: number;
}

function* parseRecordsFromChunkBuf(
  chunkBuf: Buffer,
  chunkHeader: ChunkHeader,
  startRecordId: number
): Generator<ParsedRecord> {
  const chunk: Chunk = { header: chunkHeader, offset: 0 };
  const ctx = new ParseContext(chunk);
  ctx.buff = chunkBuf;
  ctx.offset = EVTX_CHUNK_HEADER_SIZE;

  const firstRec = Number(chunkHeader.firstEventRecNumber);
  const lastRec = Number(chunkHeader.lastEventRecNumber);
  let count = 0;

  for (let i = firstRec; i <= lastRec; i++) {
    const startOfRecord = ctx.getOffset();

    if (ctx.getOffset() + EVTX_EVENT_RECORD_SIZE > chunkBuf.length) {
      break;
    }

    const recHeaderBuf = ctx.consumeBytes(EVTX_EVENT_RECORD_SIZE);
    const header = readEventRecordHeader(recHeaderBuf, 0);

    if (header.magic !== EVTX_EVENT_RECORD_MAGIC) {
      break;
    }

    const template = ctx.newTemplate(0);
    parseBinXML(ctx, false);
    const event = template.expand(null);

    if (Number(header.recordID) >= startRecordId) {
      yield {
        recordID: Number(header.recordID),
        timestamp: filetimeToUnixtime(header.fileTime),
        event: mapToObject(event),
      };
      count++;
    }

    if (count > 1024 * 10) {
      break;
    }

    ctx.setOffset(startOfRecord + header.size);
  }
}

// --- Public API (Buffer-based, sync) ---

/** Get all valid chunks in the file. */
export function getChunks(data: Buffer): ChunkInfo[] {
  const header = validateFileHeader(data);
  const result: ChunkInfo[] = [];
  let index = 0;

  for (
    let offset = header.headerBlockSize;
    offset + EVTX_CHUNK_SIZE <= data.length;
    offset += EVTX_CHUNK_SIZE
  ) {
    const chunk = validateChunk(data.subarray(offset, offset + EVTX_CHUNK_SIZE));
    if (!chunk) {
      index++;
      continue;
    }

    result.push({ index, offset, header: chunk.header });
    index++;
  }

  return result;
}

/** Parse records from a specific chunk by index. */
export function* parseEvtxChunk(
  data: Buffer,
  chunkIndex: number,
  startRecordId: number = 0
): Generator<ParsedRecord> {
  const chunks = getChunks(data);
  const chunkInfo = chunks.find((c) => c.index === chunkIndex);
  if (!chunkInfo) {
    throw new Error(
      `Chunk index ${chunkIndex} not found (valid: ${chunks.map((c) => c.index).join(", ")})`
    );
  }

  const chunk = validateChunk(data.subarray(chunkInfo.offset, chunkInfo.offset + EVTX_CHUNK_SIZE));
  if (!chunk) {
    throw new Error(`Failed to read chunk #${chunkIndex}`);
  }

  yield* parseRecordsFromChunkBuf(chunk.buf, chunk.header, startRecordId);
}

/** Parse all records in the file. */
export function* parseEvtxFile(data: Buffer): Generator<ParsedRecord> {
  const header = validateFileHeader(data);

  for (
    let offset = header.headerBlockSize;
    offset + EVTX_CHUNK_SIZE <= data.length;
    offset += EVTX_CHUNK_SIZE
  ) {
    const chunk = validateChunk(data.subarray(offset, offset + EVTX_CHUNK_SIZE));
    if (!chunk) {
      continue;
    }

    yield* parseRecordsFromChunkBuf(chunk.buf, chunk.header, 0);
  }
}

// --- Public API (DataSource-based, async) ---

/** Get all valid chunks via DataSource (reads only chunk headers). */
export async function getChunksAsync(src: DataSource): Promise<ChunkInfo[]> {
  const headerBuf = await src.readAt(0, EVTX_FILE_HEADER_SIZE);
  const header = validateFileHeader(headerBuf);
  const result: ChunkInfo[] = [];
  let index = 0;

  for (
    let offset = header.headerBlockSize;
    offset + EVTX_CHUNK_SIZE <= src.size;
    offset += EVTX_CHUNK_SIZE
  ) {
    const buf = await src.readAt(offset, EVTX_CHUNK_HEADER_SIZE);
    const chunkHeader = parseChunkHeader(buf);
    if (
      chunkHeader.magic !== EVTX_CHUNK_HEADER_MAGIC ||
      chunkHeader.lastEventRecID === 0xffffffffffffffffn
    ) {
      index++;
      continue;
    }

    result.push({ index, offset, header: chunkHeader });
    index++;
  }

  return result;
}

/** Parse records from a specific chunk by index via DataSource. */
export async function* parseEvtxChunkAsync(
  src: DataSource,
  chunkIndex: number,
  startRecordId: number = 0
): AsyncGenerator<ParsedRecord> {
  const chunks = await getChunksAsync(src);
  const chunkInfo = chunks.find((c) => c.index === chunkIndex);
  if (!chunkInfo) {
    throw new Error(
      `Chunk index ${chunkIndex} not found (valid: ${chunks.map((c) => c.index).join(", ")})`
    );
  }

  const buf = await src.readAt(chunkInfo.offset, EVTX_CHUNK_SIZE);
  const chunk = validateChunk(buf);
  if (!chunk) {
    throw new Error(`Failed to read chunk #${chunkIndex}`);
  }

  yield* parseRecordsFromChunkBuf(chunk.buf, chunk.header, startRecordId);
}

/** Parse all records via DataSource. Reads one 64KB chunk at a time. */
export async function* parseEvtxFileAsync(
  src: DataSource
): AsyncGenerator<ParsedRecord> {
  const headerBuf = await src.readAt(0, EVTX_FILE_HEADER_SIZE);
  const header = validateFileHeader(headerBuf);

  for (
    let offset = header.headerBlockSize;
    offset + EVTX_CHUNK_SIZE <= src.size;
    offset += EVTX_CHUNK_SIZE
  ) {
    const buf = await src.readAt(offset, EVTX_CHUNK_SIZE);
    const chunk = validateChunk(buf);
    if (!chunk) {
      continue;
    }

    yield* parseRecordsFromChunkBuf(chunk.buf, chunk.header, 0);
  }
}
