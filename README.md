# winevtx

Pure JavaScript Windows EVTX (Event Log) parser. Works in Node.js and browsers — no native dependencies.

## Install

```bash
npm install winevtx
```

## Usage

### Node.js — Buffer (sync)

```ts
import * as fs from "node:fs";
import { parseEvtxFile } from "winevtx";

const buf = fs.readFileSync("Security.evtx");
for (const record of parseEvtxFile(buf)) {
  console.log(record.recordID, record.timestamp, record.event);
}
```

### Node.js — DataSource (async)

```ts
import * as fs from "node:fs";
import { parseEvtxFileAsync, type DataSource } from "winevtx";

function fileDataSource(path: string): DataSource {
  const fd = fs.openSync(path, "r");
  const size = fs.fstatSync(fd).size;
  return {
    size,
    readAt(offset: number, length: number) {
      const buf = Buffer.allocUnsafe(Math.min(length, size - offset));
      fs.readSync(fd, buf, 0, buf.length, offset);
      return Promise.resolve(buf);
    },
  };
}

const src = fileDataSource("Security.evtx");
for await (const record of parseEvtxFileAsync(src)) {
  console.log(record.recordID, record.timestamp, record.event);
}
```

### Browser — File API

```ts
import { parseEvtxFileAsync, type DataSource } from "winevtx";

function fileDataSource(file: File): DataSource {
  return {
    size: file.size,
    async readAt(offset: number, length: number) {
      const blob = file.slice(offset, offset + length);
      const arrayBuf = await blob.arrayBuffer();
      return Buffer.from(arrayBuf);
    },
  };
}

const input = document.querySelector<HTMLInputElement>("#file-input")!;
input.addEventListener("change", async () => {
  const file = input.files![0];
  const src = fileDataSource(file);
  for await (const record of parseEvtxFileAsync(src)) {
    console.log(record);
  }
});
```

## API

### Sync (Buffer-based)

- **`getChunks(data: Buffer): ChunkInfo[]`** — List all valid chunks in the file.
- **`parseEvtxChunk(data: Buffer, chunkIndex: number, startRecordId?: number): Generator<ParsedRecord>`** — Parse records from a specific chunk.
- **`parseEvtxFile(data: Buffer): Generator<ParsedRecord>`** — Parse all records in the file.

### Async (DataSource-based)

- **`getChunksAsync(src: DataSource): Promise<ChunkInfo[]>`** — List all valid chunks via DataSource.
- **`parseEvtxChunkAsync(src: DataSource, chunkIndex: number, startRecordId?: number): AsyncGenerator<ParsedRecord>`** — Parse records from a specific chunk via DataSource.
- **`parseEvtxFileAsync(src: DataSource): AsyncGenerator<ParsedRecord>`** — Parse all records via DataSource.

### Helpers

- **`bufferDataSource(buf: Buffer): DataSource`** — Wrap a Buffer as a DataSource.

### Types

- **`DataSource`** — Interface for random-access reads (`size`, `readAt`).
- **`ChunkInfo`** — Chunk metadata (`index`, `offset`, `header`).
- **`ParsedRecord`** — Parsed event record (`recordID`, `timestamp`, `event`).
- **`EventRecord`** — Raw event record with header.

## License

MIT
