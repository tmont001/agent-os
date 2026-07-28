import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RunHistoryView from "./RunHistoryView.js";
import type { WorkspaceMetadata } from "../api/fetchWorkspaceCatalog.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function noBodyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockRejectedValue(new Error("should never be called")),
  } as unknown as Response;
}

const CATALOG: readonly WorkspaceMetadata[] = [
  {
    id: "job-application-review",
    displayName: "Job Application Review",
    description: "Review a draft application response.",
  },
];

const RUNS = [
  {
    id: "run-2",
    workspaceId: "job-application-review",
    createdAt: "2024-01-02T00:00:00.000Z",
    inputPreview: "Second run preview",
  },
  {
    id: "run-1",
    workspaceId: "archived-workspace",
    createdAt: "2024-01-01T00:00:00.000Z",
    inputPreview: "First run preview",
  },
];

const RECORD = {
  id: "run-2",
  workspaceId: "job-application-review",
  createdAt: "2024-01-02T00:00:00.000Z",
  input: "Original input text",
  output: "Generated output text",
};

function buildFetchMock(
  overrides: {
    list?: () => Promise<Response>;
    detail?: () => Promise<Response>;
    del?: () => Promise<Response>;
  } = {}
) {
  const listImpl = overrides.list ?? (() => Promise.resolve(jsonResponse(200, { runs: RUNS })));
  const detailImpl = overrides.detail ?? (() => Promise.resolve(jsonResponse(200, RECORD)));
  const deleteImpl = overrides.del ?? (() => Promise.resolve(noBodyResponse(204)));

  return vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      return deleteImpl();
    }
    if (url === "/v1/runs") {
      return listImpl();
    }
    return detailImpl();
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RunHistoryView", () => {
  it("shows a loading state while the list is loading", async () => {
    let resolveList!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      buildFetchMock({
        list: () =>
          new Promise<Response>((resolve) => {
            resolveList = resolve;
          }),
      })
    );

    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    expect(screen.getByText("Loading run history…")).toBeInTheDocument();
    resolveList(jsonResponse(200, { runs: [] }));
    await waitFor(() => expect(screen.queryByText("Loading run history…")).not.toBeInTheDocument());
  });

  it("shows a safe empty state when there are no saved runs", async () => {
    vi.stubGlobal("fetch", buildFetchMock({ list: () => Promise.resolve(jsonResponse(200, { runs: [] })) }));

    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    expect(await screen.findByText(/No saved runs yet/)).toBeInTheDocument();
  });

  it("shows a safe message when the list fails to load", async () => {
    vi.stubGlobal("fetch", buildFetchMock({ list: () => Promise.reject(new Error("network down")) }));

    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load run history. Please try again.");
    expect(alert.textContent).not.toContain("network down");
  });

  it("renders the list in server order with workspace label, timestamp, and preview", async () => {
    vi.stubGlobal("fetch", buildFetchMock());

    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    const rows = await screen.findAllByRole("button", { name: /preview/i });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Second run preview");
    expect(rows[1]).toHaveTextContent("First run preview");
  });

  it("uses the catalog displayName for a known workspace", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await screen.findByText("Second run preview");
    expect(screen.getByText("Job Application Review")).toBeInTheDocument();
  });

  it("uses a safe, readable fallback label for a workspace no longer in the catalog", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await screen.findByText("First run preview");
    expect(screen.getByText("Archived Workspace")).toBeInTheDocument();
  });

  it("discloses that history is local and deletion isn't a forensic-erasure guarantee", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await screen.findByText("Second run preview");
    expect(screen.getByText(/stored locally on this device only/i)).toBeInTheDocument();
    expect(screen.getByText(/not a guarantee of secure erasure/i)).toBeInTheDocument();
  });

  it("fetches and shows the full record as text after selecting an entry", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));

    expect(await screen.findByText("Original input text")).toBeInTheDocument();
    expect(screen.getByText("Generated output text")).toBeInTheDocument();
  });

  it("renders input/output as plain text, never as injected HTML", async () => {
    const maliciousRecord = { ...RECORD, output: "<img src=x onerror=alert(1)>gotcha" };
    vi.stubGlobal(
      "fetch",
      buildFetchMock({ detail: () => Promise.resolve(jsonResponse(200, maliciousRecord)) })
    );
    const user = userEvent.setup();
    const { container } = render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));

    await screen.findByText(/gotcha/);
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a missing state when the selected run's detail returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchMock({
        detail: () =>
          Promise.resolve(
            jsonResponse(404, { error: { code: "RUN_NOT_FOUND", message: "Run not found.", retryable: false } })
          ),
      })
    );
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it("shows a safe error when detail fetch fails unexpectedly", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchMock({ detail: () => Promise.resolve(jsonResponse(500, { error: "boom" })) })
    );
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load run history. Please try again.");
  });

  it("reveals a clear, permanent-deletion confirmation on first delete click", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText(/permanently.*cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
  });

  it("cancel restores the normal detail state without deleting", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("returns to a refreshed list, with the record absent, after a successful delete", async () => {
    let listCallCount = 0;
    vi.stubGlobal(
      "fetch",
      buildFetchMock({
        list: () => {
          listCallCount += 1;
          const runs = listCallCount === 1 ? RUNS : [RUNS[1]];
          return Promise.resolve(jsonResponse(200, { runs }));
        },
      })
    );
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(screen.queryByText("Second run preview")).not.toBeInTheDocument());
    expect(screen.getByText("First run preview")).toBeInTheDocument();
  });

  it("leaves the record visible with safe error copy when delete fails", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchMock({ del: () => Promise.resolve(jsonResponse(500, { error: "boom" })) })
    );
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Confirm delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to delete this run. Please try again.");
    expect(screen.getByText("Original input text")).toBeInTheDocument();
  });

  it("shows the missing state when confirming delete on an already-deleted record", async () => {
    vi.stubGlobal("fetch", buildFetchMock({ del: () => Promise.resolve(noBodyResponse(404)) }));
    const user = userEvent.setup();
    render(<RunHistoryView catalog={CATALOG} onBack={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /Second run preview/ }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });
});
