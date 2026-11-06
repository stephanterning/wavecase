import { useEffect, useState, useSyncExternalStore } from "react";
import {
  attachAudioDiagnostics,
  audioDiagnosticsEnabled,
  audioDiagnosticsReport,
  audioOutputMode,
} from "./audio-diagnostics";

const subscribe = () => () => {};
const serverSnapshot = () => false;

export function AudioDiagnosticsPanel() {
  const enabled = useSyncExternalStore(
    subscribe,
    audioDiagnosticsEnabled,
    serverSnapshot,
  );
  const [report, setReport] = useState("");
  const [message, setMessage] = useState("");
  useEffect(attachAudioDiagnostics, []);
  if (!enabled) return null;
  return (
    <details className="panel" style={{ margin: "1rem" }}>
      <summary>Audio diagnostics</summary>
      <p>Output mode: {audioOutputMode()}</p>
      <p>
        Recording in this tab only. After reproducing the problem, copy the log
        before reloading. No audio, titles or links are recorded or uploaded.
      </p>
      <button
        type="button"
        onClick={() => {
          const text = audioDiagnosticsReport();
          setReport(text);
          void navigator.clipboard?.writeText(text).then(
            () => setMessage("Log copied."),
            () => setMessage("Select and copy the log below."),
          );
          if (!navigator.clipboard)
            setMessage("Select and copy the log below.");
        }}
      >
        Copy audio log
      </button>
      <p role="status">{message}</p>
      {report && (
        <textarea
          aria-label="Audio diagnostic log"
          readOnly
          rows={10}
          value={report}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </details>
  );
}
