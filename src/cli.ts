import * as fs from "node:fs";
import {
  parseEvtxFileAsync,
  parseEvtxChunkAsync,
  getChunksAsync,
  type DataSource,
} from "./evtx.js";

function usage(): never {
  console.error(`Usage:
  npx tsx src/cli.ts parse <file.evtx>                   Parse all records (JSONL)
  npx tsx src/cli.ts chunks <file.evtx>                  List chunks
  npx tsx src/cli.ts chunk <file.evtx> <index> [startID] Parse a specific chunk`);
  process.exit(1);
}

/** DataSource backed by a file descriptor — reads only the requested range. */
function fileDataSource(filePath: string): DataSource & { close(): void } {
  const fd = fs.openSync(filePath, "r");
  const size = fs.fstatSync(fd).size;
  return {
    size,
    readAt(offset: number, length: number): Promise<Buffer> {
      const buf = Buffer.allocUnsafe(Math.min(length, size - offset));
      fs.readSync(fd, buf, 0, buf.length, offset);
      return Promise.resolve(buf);
    },
    close() {
      fs.closeSync(fd);
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const command = args[0];

  // Backward compat: if first arg looks like a file path, treat as "parse"
  if (command.endsWith(".evtx")) {
    const src = fileDataSource(command);
    try {
      for await (const record of parseEvtxFileAsync(src)) {
        console.log(JSON.stringify(record));
      }
    } finally {
      src.close();
    }
    return;
  }

  switch (command) {
    case "parse": {
      if (!args[1]) usage();
      const src = fileDataSource(args[1]);
      try {
        for await (const record of parseEvtxFileAsync(src)) {
          console.log(JSON.stringify(record));
        }
      } finally {
        src.close();
      }
      break;
    }

    case "chunks": {
      if (!args[1]) usage();
      const src = fileDataSource(args[1]);
      try {
        const chunks = await getChunksAsync(src);
        console.log(`Found ${chunks.length} chunk(s):\n`);
        for (const c of chunks) {
          console.log(
            `  Chunk #${c.index}  offset=0x${c.offset.toString(16)}  ` +
              `records=${Number(c.header.firstEventRecID)}..${Number(c.header.lastEventRecID)}  ` +
              `checksum=0x${c.header.checkSum.toString(16)}`
          );
        }
      } finally {
        src.close();
      }
      break;
    }

    case "chunk": {
      if (!args[1] || !args[2]) usage();
      const src = fileDataSource(args[1]);
      try {
        const chunkIndex = parseInt(args[2], 10);
        const startRecordId = args[3] ? parseInt(args[3], 10) : 0;
        if (isNaN(chunkIndex)) {
          console.error("Chunk index must be a number");
          process.exit(1);
        }
        for await (const record of parseEvtxChunkAsync(src, chunkIndex, startRecordId)) {
          console.log(JSON.stringify(record));
        }
      } finally {
        src.close();
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main();
