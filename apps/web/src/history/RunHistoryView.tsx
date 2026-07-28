import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteRunById,
  fetchRunById,
  fetchRunHistory,
  type RunRecord,
  type RunSummary,
} from "../api/runHistory.js";
import type { WorkspaceMetadata } from "../api/fetchWorkspaceCatalog.js";

export interface RunHistoryViewProps {
  /** The same public catalog App.tsx already fetched via GET /v1/workspaces. */
  readonly catalog: readonly WorkspaceMetadata[];
  readonly onBack: () => void;
}

type ListStatus = "loading" | "error" | "empty" | "ready";
type DetailStatus = "loading" | "missing" | "error" | "ready";
type DeleteState = "idle" | "confirming" | "deleting" | "error";

const LIST_ERROR_MESSAGE = "Unable to load run history. Please try again.";
const DETAIL_MISSING_MESSAGE = "This run is no longer available. It may have already been deleted.";

/** Safe, readable fallback for a workspace no longer in the public catalog. */
function humanizeWorkspaceId(workspaceId: string): string {
  return workspaceId
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString();
}

export default function RunHistoryView({ catalog, onBack }: RunHistoryViewProps) {
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [listErrorMessage, setListErrorMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] = useState<DetailStatus>("loading");
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunRecord | null>(null);

  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const displayNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalog) {
      map.set(entry.id, entry.displayName);
    }
    return map;
  }, [catalog]);

  function workspaceLabel(workspaceId: string): string {
    return displayNameById.get(workspaceId) ?? humanizeWorkspaceId(workspaceId);
  }

  async function loadList() {
    setListStatus("loading");
    const result = await fetchRunHistory();

    if (!result.ok) {
      setListErrorMessage(result.message);
      setListStatus("error");
      return;
    }

    if (result.runs.length === 0) {
      setRuns([]);
      setListStatus("empty");
      return;
    }

    setRuns(result.runs);
    setListStatus("ready");
  }

  // Fetched once, on entering this view — see M5_DESIGN.md Section 8.
  useEffect(() => {
    loadList();
  }, []);

  function handleSelect(id: string) {
    setSelectedId(id);
    setDetailStatus("loading");
    setDetailErrorMessage(null);
    setDeleteState("idle");
    setDeleteErrorMessage(null);

    fetchRunById(id).then((result) => {
      if (id !== selectedIdRef.current) {
        return;
      }

      if (result.status === "found") {
        setDetail(result.record);
        setDetailStatus("ready");
      } else if (result.status === "missing") {
        setDetailStatus("missing");
      } else {
        setDetailErrorMessage(result.message);
        setDetailStatus("error");
      }
    });
  }

  function handleBackToList() {
    setSelectedId(null);
    setDetail(null);
  }

  function handleDeleteClick() {
    setDeleteErrorMessage(null);
    setDeleteState("confirming");
  }

  function handleCancelDelete() {
    setDeleteState("idle");
    setDeleteErrorMessage(null);
  }

  async function handleConfirmDelete() {
    if (selectedId === null) {
      return;
    }
    const id = selectedId;
    setDeleteState("deleting");

    const result = await deleteRunById(id);

    if (result.status === "deleted") {
      setSelectedId(null);
      setDetail(null);
      await loadList();
      return;
    }

    if (result.status === "missing") {
      setDetailStatus("missing");
      setDeleteState("idle");
      return;
    }

    setDeleteErrorMessage(result.message);
    setDeleteState("error");
  }

  return (
    <div className="history-view">
      <header className="history-header">
        <div>
          <p className="product-label">Agent OS</p>
          <h1 className="title">Run History</h1>
        </div>
        <button type="button" className="secondary-button" onClick={onBack}>
          Back to workspace
        </button>
      </header>

      <p className="history-disclosure">
        Run history is stored locally on this device only. Anyone with access to this
        installation&apos;s application files can read saved runs. Deleting a run removes it from
        this history — it is not a guarantee of secure erasure from disk.
      </p>

      {selectedId === null ? (
        <section className="panel history-list-panel">
          {listStatus === "loading" && <p className="status-message">Loading run history…</p>}

          {listStatus === "error" && listErrorMessage !== null && (
            <p className="status-message status-message--error" role="alert">
              {listErrorMessage}
            </p>
          )}

          {listStatus === "empty" && (
            <p className="status-message status-message--empty">
              No saved runs yet. Successful runs will appear here.
            </p>
          )}

          {listStatus === "ready" && (
            <ul className="history-list">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    className="history-row"
                    onClick={() => handleSelect(run.id)}
                  >
                    <span className="history-row-workspace">{workspaceLabel(run.workspaceId)}</span>
                    <span className="history-row-timestamp">{formatTimestamp(run.createdAt)}</span>
                    <span className="history-row-preview">{run.inputPreview}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="panel history-detail-panel">
          {detailStatus === "loading" && <p className="status-message">Loading run…</p>}

          {detailStatus === "missing" && (
            <>
              <p className="status-message status-message--empty">{DETAIL_MISSING_MESSAGE}</p>
              <button type="button" className="secondary-button" onClick={handleBackToList}>
                Back to history
              </button>
            </>
          )}

          {detailStatus === "error" && detailErrorMessage !== null && (
            <>
              <p className="status-message status-message--error" role="alert">
                {detailErrorMessage}
              </p>
              <button type="button" className="secondary-button" onClick={handleBackToList}>
                Back to history
              </button>
            </>
          )}

          {detailStatus === "ready" && detail !== null && (
            <>
              <div className="history-detail-meta">
                <span className="history-row-workspace">{workspaceLabel(detail.workspaceId)}</span>
                <span className="history-row-timestamp">{formatTimestamp(detail.createdAt)}</span>
              </div>

              <div className="history-detail-field">
                <h2 className="field-label">Original input</h2>
                <pre className="history-detail-text">{detail.input}</pre>
              </div>

              <div className="history-detail-field">
                <h2 className="field-label">Result</h2>
                <pre className="history-detail-text">{detail.output}</pre>
              </div>

              <div className="history-detail-actions">
                <button type="button" className="secondary-button" onClick={handleBackToList}>
                  Back to history
                </button>

                {(deleteState === "idle" || deleteState === "error") && (
                  <button type="button" className="delete-button" onClick={handleDeleteClick}>
                    Delete
                  </button>
                )}

                {(deleteState === "confirming" || deleteState === "deleting") && (
                  <div className="delete-confirm">
                    <p className="delete-confirm-copy" role="alert">
                      Delete this run permanently from your local history? This cannot be undone.
                    </p>
                    <div className="delete-confirm-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleCancelDelete}
                        disabled={deleteState === "deleting"}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="delete-button delete-button--confirm"
                        onClick={handleConfirmDelete}
                        disabled={deleteState === "deleting"}
                      >
                        {deleteState === "deleting" ? "Deleting…" : "Confirm delete"}
                      </button>
                    </div>
                  </div>
                )}

                {deleteState === "error" && deleteErrorMessage !== null && (
                  <p className="status-message status-message--error" role="alert">
                    {deleteErrorMessage}
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
