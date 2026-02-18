const DEBUG = process.env.EVTX_DEBUG === "1";

export function debug(fmt: string, ...args: unknown[]): void {
  if (DEBUG) {
    console.error(fmt, ...args);
  }
}

export function utf16leToUtf8(data: Buffer): string {
  if (data.length === 0 || data.length % 2 === 1) {
    return data.toString();
  }

  // Strip trailing null chars
  let end = data.length;
  while (end >= 2 && data.readUInt16LE(end - 2) === 0) {
    end -= 2;
  }

  return data.subarray(0, end).toString("utf16le");
}

export function filetimeToUnixtime(ft: bigint): number {
  return (Number(ft) - 11644473600000 * 10000) / 10000000;
}

export function formatGUID(buf: Buffer): string {
  const d = buf.readUInt32LE(0);
  const w1 = buf.readUInt16LE(4);
  const w2 = buf.readUInt16LE(6);
  const b = buf.subarray(8, 16);
  return (
    d.toString(16).toUpperCase().padStart(8, "0") +
    "-" +
    w1.toString(16).toUpperCase().padStart(4, "0") +
    "-" +
    w2.toString(16).toUpperCase().padStart(4, "0") +
    "-" +
    b[0].toString(16).toUpperCase().padStart(2, "0") +
    b[1].toString(16).toUpperCase().padStart(2, "0") +
    "-" +
    b[2].toString(16).toUpperCase().padStart(2, "0") +
    b[3].toString(16).toUpperCase().padStart(2, "0") +
    b[4].toString(16).toUpperCase().padStart(2, "0") +
    b[5].toString(16).toUpperCase().padStart(2, "0") +
    b[6].toString(16).toUpperCase().padStart(2, "0") +
    b[7].toString(16).toUpperCase().padStart(2, "0")
  );
}

export class ParseContext {
  buff: Buffer;
  offset: number;

  root: TemplateNode;
  stack: TemplateNode[];
  currentKeys: string[];
  attributeMode: boolean;
  chunk: ChunkRef | null;
  knownIDs: Map<number, TemplateNode>;

  constructor(chunk: ChunkRef | null) {
    this.buff = Buffer.alloc(0);
    this.offset = 0;
    this.root = new TemplateNode();
    this.stack = [this.root];
    this.currentKeys = [];
    this.attributeMode = false;
    this.chunk = chunk;
    this.knownIDs = new Map();
  }

  currentKey(): string {
    if (!this.attributeMode) {
      return "";
    }
    return this.currentTemplate().currentKey;
  }

  getOffset(): number {
    return this.offset;
  }

  setOffset(offset: number): void {
    this.offset = offset;
  }

  pushTemplate(key: string, template: TemplateNode): void {
    debug("PushTemplate: %x -> %x", this.stack.length, this.stack.length + 1);
    const current = this.currentTemplate();
    current.setNested(key, template);
    if (this.stack.length < 1024 * 10) {
      this.stack.push(template);
    }
  }

  currentTemplate(): TemplateNode {
    if (this.stack.length > 0) {
      return this.stack[this.stack.length - 1];
    }
    return new TemplateNode();
  }

  popTemplate(): void {
    if (this.stack.length > 0) {
      debug("PopTemplate: %x -> %x", this.stack.length, this.stack.length - 1);
      this.stack.pop();
    }
  }

  newTemplate(id: number): TemplateNode {
    this.root = new TemplateNode();
    this.stack = [this.root];

    if (id !== 0) {
      this.knownIDs.set(id, this.root);
    }

    return this.root;
  }

  getTemplateByID(id: number): TemplateNode | undefined {
    return this.knownIDs.get(id);
  }

  copy(): ParseContext {
    const result = new ParseContext(this.chunk);
    result.buff = this.buff;
    result.offset = this.offset;
    result.knownIDs = this.knownIDs;
    return result;
  }

  consumeUint8(): number {
    if (this.buff.length < this.offset + 1) return 0;
    const result = this.buff[this.offset];
    this.offset++;
    return result;
  }

  consumeUint16(): number {
    if (this.buff.length < this.offset + 2) return 0;
    const result = this.buff.readUInt16LE(this.offset);
    this.offset += 2;
    return result;
  }

  consumeUint32(): number {
    if (this.buff.length < this.offset + 4) return 0;
    const result = this.buff.readUInt32LE(this.offset);
    this.offset += 4;
    return result;
  }

  consumeUint64(): bigint {
    if (this.buff.length < this.offset + 8) return 0n;
    const result = this.buff.readBigUInt64LE(this.offset);
    this.offset += 8;
    return result;
  }

  consumeInt32(): number {
    if (this.buff.length < this.offset + 4) return 0;
    const result = this.buff.readInt32LE(this.offset);
    this.offset += 4;
    return result;
  }

  consumeInt64(): bigint {
    if (this.buff.length < this.offset + 8) return 0n;
    const result = this.buff.readBigInt64LE(this.offset);
    this.offset += 8;
    return result;
  }

  consumeReal32(): number {
    if (this.buff.length < this.offset + 4) return 0;
    const result = this.buff.readFloatLE(this.offset);
    this.offset += 4;
    return result;
  }

  consumeReal64(): number {
    if (this.buff.length < this.offset + 8) return 0;
    const result = this.buff.readDoubleLE(this.offset);
    this.offset += 8;
    return result;
  }

  consumeBytes(size: number): Buffer {
    if (this.offset + size > this.buff.length) {
      return Buffer.alloc(size);
    }
    const result = this.buff.subarray(this.offset, this.offset + size);
    this.offset += size;
    return result;
  }

  consumeSysTime(size: number): string {
    if (this.buff.length < this.offset + 16) {
      return "SysTimeParsingError";
    }
    const buffer = this.buff.subarray(this.offset, this.offset + size);
    this.offset += size;

    const year = buffer.readUInt16LE(0);
    const month = buffer.readUInt16LE(2);
    const day = buffer.readUInt16LE(6);
    const hour = buffer.readUInt16LE(8);
    const min = buffer.readUInt16LE(10);
    const sec = buffer.readUInt16LE(12);
    const msec = buffer.readUInt16LE(14);

    const date = new Date(Date.UTC(year, month - 1, day, hour, min, sec, msec));
    return date.toISOString();
  }

  consumeUint16Array(size: number): number[] {
    if (this.offset + size >= this.buff.length) {
      size = this.buff.length - this.offset - 1;
    }
    if (this.offset > this.buff.length) return [];

    const buffer = this.buff.subarray(this.offset, this.offset + size);
    this.offset += size;

    const result: number[] = [];
    for (let i = 0; i + 1 < buffer.length; i += 2) {
      result.push(buffer.readUInt16LE(i));
    }
    return result;
  }

  consumeUint64Array(size: number): bigint[] {
    if (this.offset + size >= this.buff.length) {
      size = this.buff.length - this.offset - 1;
    }
    if (this.offset > this.buff.length) return [];

    const buffer = this.buff.subarray(this.offset, this.offset + size);
    this.offset += size;

    const result: bigint[] = [];
    for (let i = 0; i + 7 < buffer.length; i += 8) {
      result.push(buffer.readBigUInt64LE(i));
    }
    return result;
  }

  consumeInt64HexArray(size: number): string[] {
    if (this.offset + size >= this.buff.length) {
      size = this.buff.length - this.offset - 1;
    }
    if (this.offset > this.buff.length) return [];

    const buffer = this.buff.subarray(this.offset, this.offset + size);
    this.offset += size;

    const result: string[] = [];
    for (let i = 0; i + 7 < buffer.length; i += 8) {
      const val = buffer.readBigInt64LE(i);
      result.push("0x" + val.toString(16));
    }
    return result;
  }

  skipBytes(count: number): void {
    this.offset += count;
  }
}

export function readPrefixedUnicodeString(
  ctx: ParseContext,
  isNullTerminated: boolean
): string {
  debug("ReadPrefixedUnicodeString Enter: %x", ctx.getOffset());
  let count = ctx.consumeUint16();
  if (isNullTerminated) {
    count += 1;
  }
  debug("ReadPrefixedUnicodeString count: %d", count);
  const buffer = ctx.consumeBytes(count * 2);
  const result = utf16leToUtf8(buffer);
  debug("ReadPrefixedUnicodeString exit: %x %s", ctx.getOffset(), result);
  return result;
}

export function readName(ctx: ParseContext): string {
  debug("ReadName Enter: %x", ctx.getOffset());
  const chunkOffset = ctx.consumeUint32();
  debug("chunkOffset %x ctx offset %x", chunkOffset, ctx.getOffset());

  if (chunkOffset !== ctx.getOffset()) {
    const tempCtx = ctx.copy();
    tempCtx.setOffset(chunkOffset);
    tempCtx.skipBytes(4 + 2);
    return readPrefixedUnicodeString(tempCtx, true);
  }

  ctx.skipBytes(4 + 2);
  return readPrefixedUnicodeString(ctx, true);
}

// ChunkRef is a minimal interface to avoid circular dependency
export interface ChunkRef {
  offset: number;
}

// TemplateNode - mirrors Go's TemplateNode
export class TemplateNode {
  id: number = 0;
  type: number = 0;
  literal: unknown = null;
  nestedArray: TemplateNode[] | null = null;
  nestedDict: Map<string, TemplateNode> | null = null;
  currentKey: string = "";

  expand(args: Map<number, unknown> | null): unknown {
    if (this.nestedDict !== null) {
      const result = new Map<string, unknown>();
      for (const [k, v] of this.nestedDict) {
        const expanded = v.expand(args);
        if (k === "") {
          const key = "Value";
          if (this.nestedDict.size === 1) {
            return expanded;
          }

          if (expanded instanceof Map) {
            for (const [ek, ev] of expanded as Map<string, unknown>) {
              if (ev != null) {
                result.set(ek, ev);
              }
            }
            continue;
          }
          if (expanded != null) {
            result.set(key, expanded);
          }
        } else {
          if (expanded != null) {
            result.set(k, expanded);
          }
        }
      }
      return result;
    } else if (this.literal != null) {
      return this.literal;
    } else if (this.nestedArray !== null) {
      return this.nestedArray.map((i) => i.expand(args));
    } else if (args !== null) {
      const value = args.get(this.id);
      if (value === undefined) {
        return null;
      }
      return value;
    }
    return null;
  }

  setLiteral(key: string, literal: unknown): void {
    if (this.nestedDict === null) {
      this.nestedDict = new Map();
    }
    if (key !== "xmlns") {
      this.nestedDict.set(key, new TemplateNode().withLiteral(literal));
    }
  }

  setExpansion(key: string, id: number, typeId: number): void {
    if (this.nestedDict === null) {
      this.nestedDict = new Map();
    }
    const node = new TemplateNode();
    node.id = id;
    node.type = typeId;
    this.nestedDict.set(key, node);
  }

  setNested(key: string, nested: TemplateNode): void {
    if (this.nestedDict === null) {
      this.nestedDict = new Map();
    }

    const existing = this.nestedDict.get(key);
    if (existing !== undefined) {
      if (existing.nestedArray !== null) {
        if (existing.nestedArray.length < 1024 * 10) {
          existing.nestedArray.push(nested);
        }
        return;
      }
      nested = new TemplateNode().withNestedArray([existing, nested]);
    }
    this.nestedDict.set(key, nested);
  }

  private withLiteral(literal: unknown): TemplateNode {
    this.literal = literal;
    return this;
  }

  private withNestedArray(arr: TemplateNode[]): TemplateNode {
    this.nestedArray = arr;
    return this;
  }
}

// Convert Map-based result to plain object for JSON serialization
export function mapToObject(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) {
      obj[k] = mapToObject(v);
    }
    return obj;
  }
  if (Array.isArray(value)) {
    return value.map(mapToObject);
  }
  if (typeof value === "bigint") {
    // Safe integer range
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
      return Number(value);
    }
    return value.toString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("hex");
  }
  return value;
}
