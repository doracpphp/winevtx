import { Buffer } from "buffer";
import type { DataSource } from "../../src/evtx.ts";

/** Browser File API backed DataSource — reads only the requested slice. */
export function fileDataSource(file: File): DataSource {
  return {
    size: file.size,
    async readAt(offset: number, size: number): Promise<Buffer> {
      const blob = file.slice(offset, offset + size);
      const ab = await blob.arrayBuffer();
      return Buffer.from(ab);
    },
  };
}
