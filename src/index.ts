export {
  type DataSource,
  bufferDataSource,
  type ChunkInfo,
  type ParsedRecord,
  type EventRecord,
  getChunks,
  parseEvtxChunk,
  parseEvtxFile,
  getChunksAsync,
  parseEvtxChunkAsync,
  parseEvtxFileAsync,
} from "./evtx.js";
