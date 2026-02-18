import { Buffer } from "buffer";

// Make Buffer available globally for the evtx parser library
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as unknown as Record<string, unknown>).Buffer = Buffer;
}
