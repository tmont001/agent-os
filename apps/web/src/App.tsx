import { useId, useState } from "react";
import { runWorkspace } from "./api/runWorkspace.js";

const WORKSPACE_ID = "job-application-review";

type Status = "idle" | "loading" | "success" | "error";

export default function App() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputId = useId();
  const canSubmit = input.trim().length > 0 && status !== "loading";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setStatus("loading");
    setErrorMessage(null);

    const result = await runWorkspace({ workspaceId: WORKSPACE_ID, input });

    if (result.ok) {
      setOutput(result.output);
      setStatus("success");
    } else {
      setErrorMessage(result.message);
      setStatus("error");
    }
  }

  return (
    <div className="page">
      <div className="page-content">
        <header className="header">
          <p className="product-label">Agent OS</p>
          <h1 className="title">Job Application Review</h1>
          <p className="description">
            Paste your draft answer to an application question. Agent OS reviews it against
            only what you wrote and returns what&apos;s strong, what needs work, and a revised
            version.
          </p>
        </header>

        <div className="workspace">
          <form className="panel input-panel" onSubmit={handleSubmit} noValidate>
            <label className="field-label" htmlFor={inputId}>
              Your response
            </label>
            <textarea
              id={inputId}
              className="textarea"
              placeholder="Paste the application question (optional) and your draft answer here…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={10}
            />
            <div className="field-meta">
              <span className="char-count">{input.length} characters</span>
            </div>
            <button type="submit" className="submit-button" disabled={!canSubmit}>
              {status === "loading" ? "Reviewing…" : "Review response"}
            </button>
            <p className="trust-note">
              Uses only the information you provide. It will not invent experience or results.
            </p>
          </form>

          <section className="panel review-panel">
            <h2 className="results-heading">Review</h2>
            <div
              className={`review-content${status === "idle" ? " review-content--empty" : ""}`}
              aria-live="polite"
            >
              {status === "idle" && (
                <p className="status-message status-message--empty">
                  Your review will appear here after you submit a response.
                </p>
              )}

              {status === "loading" && (
                <p className="status-message">Reviewing your response…</p>
              )}

              {status === "error" && errorMessage !== null && (
                <p className="status-message status-message--error" role="alert">
                  {errorMessage}
                </p>
              )}

              {status === "success" && output !== null && (
                <pre className="results-output">{output}</pre>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
