import { useEffect, useId, useRef, useState } from "react";
import { runWorkspace } from "./api/runWorkspace.js";
import { fetchWorkspaceCatalog, type WorkspaceMetadata } from "./api/fetchWorkspaceCatalog.js";
import { getWorkspacePresentation } from "./workspacePresentation.js";
import RunHistoryView from "./history/RunHistoryView.js";

const DEFAULT_WORKSPACE_ID = "job-application-review";
const EMPTY_CATALOG_MESSAGE = "No workspaces are available right now.";
const PERSISTENCE_WARNING = "This result was generated but could not be saved to history.";
const LOCAL_SAVE_DISCLOSURE = "Successful results are saved locally on this device.";

type CatalogStatus = "loading" | "error" | "empty" | "ready";
type RunStatus = "idle" | "loading" | "success" | "error";
type View = "runner" | "history";

export default function App() {
  const [view, setView] = useState<View>("runner");

  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("loading");
  const [catalogErrorMessage, setCatalogErrorMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<readonly WorkspaceMetadata[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const inputId = useId();
  const selectId = useId();

  // Read at response time to discard a stale in-flight run if the user
  // somehow changes the selection before it resolves — a response must
  // never render under a different workspace's heading.
  const selectedWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    fetchWorkspaceCatalog().then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setCatalogErrorMessage(result.message);
        setCatalogStatus("error");
        return;
      }

      const [firstEntry] = result.workspaces;
      if (firstEntry === undefined) {
        setCatalogStatus("empty");
        return;
      }

      const defaultEntry =
        result.workspaces.find((entry) => entry.id === DEFAULT_WORKSPACE_ID) ?? firstEntry;

      setCatalog(result.workspaces);
      setSelectedWorkspaceId(defaultEntry.id);
      setCatalogStatus("ready");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedWorkspace = catalog.find((entry) => entry.id === selectedWorkspaceId) ?? null;
  const presentation = getWorkspacePresentation(selectedWorkspaceId ?? "");
  const canSubmit =
    input.trim().length > 0 && runStatus !== "loading" && selectedWorkspaceId !== null;

  function handleWorkspaceChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedWorkspaceId(event.target.value);
    setOutput(null);
    setErrorMessage(null);
    setRunStatus("idle");
    setPersisted(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || selectedWorkspaceId === null) {
      return;
    }

    const workspaceId = selectedWorkspaceId;
    setRunStatus("loading");
    setErrorMessage(null);
    setPersisted(null);

    const result = await runWorkspace({ workspaceId, input });

    if (workspaceId !== selectedWorkspaceIdRef.current) {
      return;
    }

    if (result.ok) {
      setOutput(result.output);
      setPersisted(result.persisted);
      setRunStatus("success");
    } else {
      setErrorMessage(result.message);
      setRunStatus("error");
    }
  }

  return (
    <div className="page">
      <div className="page-content">
        {view === "history" ? (
          <RunHistoryView catalog={catalog} onBack={() => setView("runner")} />
        ) : (
          <>
            {catalogStatus === "loading" && <p className="status-message">Loading workspaces…</p>}

            {catalogStatus === "error" && (
              <p className="status-message status-message--error" role="alert">
                {catalogErrorMessage}
              </p>
            )}

            {catalogStatus === "empty" && (
              <p className="status-message status-message--error" role="alert">
                {EMPTY_CATALOG_MESSAGE}
              </p>
            )}

            {catalogStatus === "ready" && selectedWorkspace !== null && (
              <>
                <header className="header">
                  <div className="header-top">
                    <p className="product-label">Agent OS</p>
                    <div className="header-controls">
                      <button
                        type="button"
                        className="secondary-button history-nav-button"
                        onClick={() => setView("history")}
                        disabled={runStatus === "loading"}
                      >
                        History
                      </button>
                      <div className="workspace-select-row">
                        <label className="field-label" htmlFor={selectId}>
                          Workspace
                        </label>
                        <select
                          id={selectId}
                          className="workspace-select"
                          value={selectedWorkspace.id}
                          onChange={handleWorkspaceChange}
                          disabled={runStatus === "loading"}
                        >
                          {catalog.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.displayName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <h1 className="title">{selectedWorkspace.displayName}</h1>
                  <p className="description">{selectedWorkspace.description}</p>
                </header>

                <div className="workspace">
                  <form className="panel input-panel" onSubmit={handleSubmit} noValidate>
                    <label className="field-label" htmlFor={inputId}>
                      Your input
                    </label>
                    <textarea
                      id={inputId}
                      className="textarea"
                      placeholder={presentation.placeholder}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      rows={10}
                    />
                    <div className="field-meta">
                      <span className="char-count">{input.length} characters</span>
                    </div>
                    <button type="submit" className="submit-button" disabled={!canSubmit}>
                      {runStatus === "loading"
                        ? presentation.submitLabelLoading
                        : presentation.submitLabel}
                    </button>
                    <p className="trust-note">{presentation.trustNote}</p>
                    <p className="local-save-disclosure">{LOCAL_SAVE_DISCLOSURE}</p>
                  </form>

                  <section className="panel review-panel">
                    <h2 className="results-heading">Result</h2>
                    <div
                      className={`review-content${runStatus === "idle" ? " review-content--empty" : ""}`}
                      aria-live="polite"
                    >
                      {runStatus === "idle" && (
                        <p className="status-message status-message--empty">
                          Your result will appear here after you submit.
                        </p>
                      )}

                      {runStatus === "loading" && <p className="status-message">Running…</p>}

                      {runStatus === "error" && errorMessage !== null && (
                        <p className="status-message status-message--error" role="alert">
                          {errorMessage}
                        </p>
                      )}

                      {runStatus === "success" && output !== null && (
                        <>
                          <pre className="results-output">{output}</pre>
                          {persisted === false && (
                            <p className="status-message status-message--warning" role="status">
                              {PERSISTENCE_WARNING}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
