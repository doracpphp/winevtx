import { useState, useCallback, useRef } from "react";
import {
  getChunksAsync,
  parseEvtxChunkAsync,
  type ChunkInfo,
  type ParsedRecord,
} from "../../src/evtx.ts";
import { fileDataSource } from "./file-data-source.ts";
import type { DataSource } from "../../src/evtx.ts";

export function App() {
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);
  const [records, setRecords] = useState<ParsedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const srcRef = useRef<DataSource | null>(null);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);
      setRecords([]);
      setSelectedChunk(null);
      setFileName(file.name);
      setLoading(true);

      try {
        const src = fileDataSource(file);
        srcRef.current = src;
        const chunkList = await getChunksAsync(src);
        setChunks(chunkList);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleChunkSelect = useCallback(async (chunkIndex: number) => {
    const src = srcRef.current;
    if (!src) return;

    setSelectedChunk(chunkIndex);
    setRecords([]);
    setLoading(true);
    setError(null);

    try {
      const result: ParsedRecord[] = [];
      for await (const record of parseEvtxChunkAsync(src, chunkIndex)) {
        result.push(record);
      }
      setRecords(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
        EVTX Viewer
      </h1>

      <input type="file" accept=".evtx" onChange={handleFile} />

      {error && (
        <div style={{ color: "red", margin: "0.5rem 0" }}>{error}</div>
      )}

      {loading && <div style={{ margin: "0.5rem 0" }}>Loading...</div>}

      {fileName && chunks.length > 0 && (
        <div style={{ margin: "1rem 0" }}>
          <h2 style={{ fontSize: "1rem" }}>
            {fileName} — {chunks.length} chunk(s)
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {chunks.map((c) => (
              <button
                key={c.index}
                onClick={() => handleChunkSelect(c.index)}
                style={{
                  padding: "0.25rem 0.5rem",
                  background: selectedChunk === c.index ? "#0066cc" : "#eee",
                  color: selectedChunk === c.index ? "#fff" : "#333",
                  border: "1px solid #ccc",
                  borderRadius: "3px",
                  cursor: "pointer",
                }}
              >
                #{c.index} ({Number(c.header.firstEventRecID)}..
                {Number(c.header.lastEventRecID)})
              </button>
            ))}
          </div>
        </div>
      )}

      {records.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem" }}>
            Chunk #{selectedChunk} — {records.length} record(s)
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                borderCollapse: "collapse",
                fontSize: "0.8rem",
                width: "100%",
              }}
            >
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={th}>RecordID</th>
                  <th style={th}>Timestamp</th>
                  <th style={th}>Provider</th>
                  <th style={th}>EventID</th>
                  <th style={th}>Computer</th>
                  <th style={th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const sys = getSystem(r.event);
                  return (
                    <tr key={r.recordID} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={td}>{r.recordID}</td>
                      <td style={td}>
                        {new Date(r.timestamp * 1000).toISOString()}
                      </td>
                      <td style={td}>{sys.provider}</td>
                      <td style={td}>{sys.eventId}</td>
                      <td style={td}>{sys.computer}</td>
                      <td style={td}>
                        <details>
                          <summary style={{ cursor: "pointer" }}>JSON</summary>
                          <pre
                            style={{
                              maxHeight: "200px",
                              overflow: "auto",
                              fontSize: "0.7rem",
                              whiteSpace: "pre-wrap",
                              margin: 0,
                            }}
                          >
                            {JSON.stringify(r.event, null, 2)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.4rem",
  borderBottom: "2px solid #ccc",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "0.4rem",
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

function getSystem(event: unknown): {
  provider: string;
  eventId: string;
  computer: string;
} {
  const empty = { provider: "", eventId: "", computer: "" };
  if (!event || typeof event !== "object") return empty;
  const evt = (event as Record<string, unknown>).Event;
  if (!evt || typeof evt !== "object") return empty;
  const sys = (evt as Record<string, unknown>).System;
  if (!sys || typeof sys !== "object") return empty;
  const s = sys as Record<string, unknown>;
  const prov = s.Provider as Record<string, unknown> | undefined;
  const eid = s.EventID as Record<string, unknown> | undefined;
  return {
    provider: String(prov?.Name ?? ""),
    eventId: String(eid?.Value ?? eid ?? ""),
    computer: String(s.Computer ?? ""),
  };
}
