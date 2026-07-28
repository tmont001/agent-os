import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.js";

/**
 * fetch is mocked at the module boundary — api/runWorkspace.ts and
 * api/fetchWorkspaceCatalog.ts are the only modules that call it — no real
 * network socket, no real Express server, no Anthropic key. See
 * docs/milestones/M4_DESIGN.md Section 6.
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const DEFAULT_CATALOG = {
  workspaces: [
    {
      id: "job-application-review",
      displayName: "Job Application Review",
      description: "Review a draft application response and get feedback.",
    },
    {
      id: "research-brief",
      displayName: "Research Brief",
      description: "Turn notes into a summary, key findings, and open questions.",
    },
  ],
};

function buildFetchMock(
  options: {
    catalog?: () => Promise<Response>;
    run?: () => Promise<Response>;
    history?: () => Promise<Response>;
  } = {}
) {
  const catalogImpl = options.catalog ?? (() => Promise.resolve(jsonResponse(200, DEFAULT_CATALOG)));
  const runImpl =
    options.run ??
    (() =>
      Promise.resolve(jsonResponse(200, { output: "Strong: ...", runId: "run-1", persisted: true })));
  const historyImpl = options.history ?? (() => Promise.resolve(jsonResponse(200, { runs: [] })));

  return vi.fn((url: string, init?: RequestInit) => {
    if (url === "/v1/workspaces") {
      return catalogImpl();
    }
    if (url === "/v1/runs" && init?.method === "POST") {
      return runImpl();
    }
    if (url === "/v1/runs") {
      return historyImpl();
    }
    return Promise.resolve(
      jsonResponse(404, {
        error: { code: "RUN_NOT_FOUND", message: "Run not found.", retryable: false },
      })
    );
  });
}

function findRunRequestBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const call = fetchMock.mock.calls.find(([url]) => url === "/v1/runs");
  const [, options] = call as [string, RequestInit];
  return JSON.parse(options.body as string);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the page heading and labeled input", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Job Application Review" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your input")).toBeInTheDocument();
  });

  it("shows the empty result state before any submission", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    expect(
      screen.getByText("Your result will appear here after you submit.")
    ).toBeInTheDocument();
  });

  it("disables submission for empty input", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    expect(screen.getByRole("button", { name: "Review response" })).toBeDisabled();
  });

  it("disables submission for whitespace-only input", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "   ");

    expect(screen.getByRole("button", { name: "Review response" })).toBeDisabled();
  });

  it("sends the exact workspaceId and input on a valid submission", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/v1/runs")).toBe(true));
    expect(findRunRequestBody(fetchMock)).toEqual({
      workspaceId: "job-application-review",
      input: "I led the migration.",
    });
  });

  it("disables the button while a request is in flight, preventing duplicate submission", async () => {
    let resolveRun!: (value: Response) => void;
    const fetchMock = buildFetchMock({
      run: () =>
        new Promise<Response>((resolve) => {
          resolveRun = resolve;
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "I led the migration.");
    const button = screen.getByRole("button", { name: "Review response" });
    await user.click(button);

    expect(screen.getByRole("button", { name: "Reviewing…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reviewing…" }));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/v1/runs")).toHaveLength(1);

    resolveRun(jsonResponse(200, { output: "done", runId: "run-1", persisted: true }));
    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
  });

  it("renders successful output, preserving whitespace", async () => {
    const fetchMock = buildFetchMock({
      run: () =>
        Promise.resolve(
          jsonResponse(200, {
            output: "Strong\n\nClear and specific.",
            runId: "run-1",
            persisted: true,
          })
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    const output = await screen.findByText("Clear and specific.", { exact: false });
    expect(output).toBeInTheDocument();
    expect(output.textContent).toBe("Strong\n\nClear and specific.");
  });

  it("displays the safe message from a structured API error", async () => {
    const fetchMock = buildFetchMock({
      run: () =>
        Promise.resolve(
          jsonResponse(404, {
            error: { code: "WORKSPACE_NOT_FOUND", message: "No workspace found.", retryable: false },
          })
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No workspace found.");
  });

  it("displays a generic safe message for a run network failure", async () => {
    const fetchMock = buildFetchMock({ run: () => Promise.reject(new Error("network down")) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
    expect(alert.textContent).not.toContain("network down");
  });

  it("displays a generic safe message for a malformed run response", async () => {
    const fetchMock = buildFetchMock({
      run: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new Error("not json")),
        } as Response),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again."
    );
  });

  it("renders model output as text, not injected HTML", async () => {
    const maliciousOutput = "<img src=x onerror=alert(1)>Strong section";
    const fetchMock = buildFetchMock({
      run: () =>
        Promise.resolve(
          jsonResponse(200, { output: maliciousOutput, runId: "run-1", persisted: true })
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<App />);

    await screen.findByRole("heading", { name: "Job Application Review" });
    await user.type(screen.getByLabelText("Your input"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    await waitFor(() => expect(screen.queryByText(/Strong section/)).toBeInTheDocument());
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(maliciousOutput, { exact: false })).toBeInTheDocument();
  });

  describe("workspace catalog", () => {
    it("shows a loading state while the catalog is loading", async () => {
      let resolveCatalog!: (value: Response) => void;
      const fetchMock = buildFetchMock({
        catalog: () =>
          new Promise<Response>((resolve) => {
            resolveCatalog = resolve;
          }),
      });
      vi.stubGlobal("fetch", fetchMock);
      render(<App />);

      expect(screen.getByText("Loading workspaces…")).toBeInTheDocument();

      resolveCatalog(jsonResponse(200, DEFAULT_CATALOG));
      await screen.findByRole("heading", { name: "Job Application Review" });
    });

    it("renders the selector with both catalog entries, defaulting to Job Application Review", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      const select = screen.getByLabelText("Workspace") as HTMLSelectElement;

      expect(select.value).toBe("job-application-review");
      expect(screen.getByRole("option", { name: "Job Application Review" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Research Brief" })).toBeInTheDocument();
    });

    it("switching the selector updates the heading/description and the workspaceId used for submission", async () => {
      const fetchMock = buildFetchMock();
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.selectOptions(screen.getByLabelText("Workspace"), "research-brief");

      expect(screen.getByRole("heading", { name: "Research Brief" })).toBeInTheDocument();
      expect(
        screen.getByText("Turn notes into a summary, key findings, and open questions.")
      ).toBeInTheDocument();

      await user.type(screen.getByLabelText("Your input"), "Some notes.");
      await user.click(screen.getByRole("button", { name: "Generate brief" }));

      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/v1/runs")).toBe(true));
      expect(findRunRequestBody(fetchMock)).toEqual({
        workspaceId: "research-brief",
        input: "Some notes.",
      });
    });

    it("updates the trust note when the workspace selection changes", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      expect(
        screen.getByText(
          "Uses only the information you provide. It will not invent experience or results."
        )
      ).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Workspace"), "research-brief");

      expect(
        screen.getByText(
          "Uses only the material you provide. It will not add outside sources or unsupported claims."
        )
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "Uses only the information you provide. It will not invent experience or results."
        )
      ).not.toBeInTheDocument();
    });

    it("preserves textarea input when switching workspaces", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "Some shared material.");
      await user.selectOptions(screen.getByLabelText("Workspace"), "research-brief");

      expect(screen.getByLabelText("Your input")).toHaveValue("Some shared material.");
    });

    it("clears prior output when switching workspaces after a completed run", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));
      await screen.findByText("Strong: ...");

      await user.selectOptions(screen.getByLabelText("Workspace"), "research-brief");

      expect(screen.queryByText("Strong: ...")).not.toBeInTheDocument();
      expect(
        screen.getByText("Your result will appear here after you submit.")
      ).toBeInTheDocument();
    });

    it("disables the workspace selector while a run is in flight", async () => {
      let resolveRun!: (value: Response) => void;
      const fetchMock = buildFetchMock({
        run: () =>
          new Promise<Response>((resolve) => {
            resolveRun = resolve;
          }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));

      expect(screen.getByLabelText("Workspace")).toBeDisabled();

      resolveRun(jsonResponse(200, { output: "done", runId: "run-1", persisted: true }));
      await waitFor(() => expect(screen.getByLabelText("Workspace")).not.toBeDisabled());
    });

    it("shows a safe message when the catalog fetch fails", async () => {
      vi.stubGlobal(
        "fetch",
        buildFetchMock({ catalog: () => Promise.reject(new Error("network down")) })
      );
      render(<App />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Unable to load workspaces. Please try again.");
      expect(alert.textContent).not.toContain("network down");
    });

    it("shows a safe message when the catalog is empty", async () => {
      vi.stubGlobal(
        "fetch",
        buildFetchMock({ catalog: () => Promise.resolve(jsonResponse(200, { workspaces: [] })) })
      );
      render(<App />);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No workspaces are available right now."
      );
    });

    it("shows a safe message when the catalog response is malformed", async () => {
      vi.stubGlobal(
        "fetch",
        buildFetchMock({
          catalog: () => Promise.resolve(jsonResponse(200, { workspaces: "not-an-array" })),
        })
      );
      render(<App />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Unable to load workspaces. Please try again.");
    });

    it("shows a safe message when the catalog contains duplicate workspace ids", async () => {
      vi.stubGlobal(
        "fetch",
        buildFetchMock({
          catalog: () =>
            Promise.resolve(
              jsonResponse(200, {
                workspaces: [
                  { id: "dup", displayName: "One", description: "d" },
                  { id: "dup", displayName: "Two", description: "d" },
                ],
              })
            ),
        })
      );
      render(<App />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Unable to load workspaces. Please try again.");
    });
  });

  describe("run history navigation", () => {
    it("shows the runner as the initial view", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    });

    it("opens the history view showing its empty state", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.click(screen.getByRole("button", { name: "History" }));

      expect(await screen.findByRole("heading", { name: "Run History" })).toBeInTheDocument();
      expect(await screen.findByText(/No saved runs yet/)).toBeInTheDocument();
    });

    it("returns to the runner via Back", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.click(screen.getByRole("button", { name: "History" }));
      await screen.findByRole("heading", { name: "Run History" });

      await user.click(screen.getByRole("button", { name: "Back to workspace" }));

      expect(
        await screen.findByRole("heading", { name: "Job Application Review" })
      ).toBeInTheDocument();
    });

    it("preserves textarea input across a visit to history", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "Draft in progress");
      await user.click(screen.getByRole("button", { name: "History" }));
      await screen.findByRole("heading", { name: "Run History" });
      await user.click(screen.getByRole("button", { name: "Back to workspace" }));

      expect(await screen.findByLabelText("Your input")).toHaveValue("Draft in progress");
    });

    it("preserves the selected workspace across a visit to history", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.selectOptions(screen.getByLabelText("Workspace"), "research-brief");
      await user.click(screen.getByRole("button", { name: "History" }));
      await screen.findByRole("heading", { name: "Run History" });
      await user.click(screen.getByRole("button", { name: "Back to workspace" }));

      expect(await screen.findByRole("heading", { name: "Research Brief" })).toBeInTheDocument();
    });

    it("preserves prior output across a visit to history", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));
      await screen.findByText("Strong: ...");

      await user.click(screen.getByRole("button", { name: "History" }));
      await screen.findByRole("heading", { name: "Run History" });
      await user.click(screen.getByRole("button", { name: "Back to workspace" }));

      expect(await screen.findByText("Strong: ...")).toBeInTheDocument();
    });

    it("disables History navigation while a run is actively loading", async () => {
      let resolveRun!: (value: Response) => void;
      const fetchMock = buildFetchMock({
        run: () =>
          new Promise<Response>((resolve) => {
            resolveRun = resolve;
          }),
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));

      expect(screen.getByRole("button", { name: "History" })).toBeDisabled();

      resolveRun(jsonResponse(200, { output: "done", runId: "run-1", persisted: true }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "History" })).not.toBeDisabled()
      );
    });
  });

  describe("persistence warning and local-save disclosure", () => {
    it("shows the standing local-save disclosure near the submit area", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      render(<App />);

      expect(
        await screen.findByText("Successful results are saved locally on this device.")
      ).toBeInTheDocument();
    });

    it("keeps the output and shows a warning when persisted:false", async () => {
      vi.stubGlobal(
        "fetch",
        buildFetchMock({
          run: () =>
            Promise.resolve(jsonResponse(200, { output: "Strong: ...", runId: null, persisted: false })),
        })
      );
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));

      expect(await screen.findByText("Strong: ...")).toBeInTheDocument();
      expect(
        screen.getByText("This result was generated but could not be saved to history.")
      ).toBeInTheDocument();
    });

    it("does not show the warning when persisted:true", async () => {
      vi.stubGlobal("fetch", buildFetchMock());
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));

      await screen.findByText("Strong: ...");
      expect(
        screen.queryByText("This result was generated but could not be saved to history.")
      ).not.toBeInTheDocument();
    });

    it("clears the warning on the next run", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        buildFetchMock({
          run: () => {
            callCount += 1;
            const persisted = callCount !== 1;
            return Promise.resolve(
              jsonResponse(200, {
                output: `Result ${callCount}`,
                runId: persisted ? "run-1" : null,
                persisted,
              })
            );
          },
        })
      );
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));
      await screen.findByText("This result was generated but could not be saved to history.");

      await user.click(screen.getByRole("button", { name: "Review response" }));
      await screen.findByText("Result 2");

      expect(
        screen.queryByText("This result was generated but could not be saved to history.")
      ).not.toBeInTheDocument();
    });

    it("clears the warning when switching workspaces", async () => {
      vi.stubGlobal(
        "fetch",
        buildFetchMock({
          run: () =>
            Promise.resolve(jsonResponse(200, { output: "Strong: ...", runId: null, persisted: false })),
        })
      );
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("heading", { name: "Job Application Review" });
      await user.type(screen.getByLabelText("Your input"), "I led the migration.");
      await user.click(screen.getByRole("button", { name: "Review response" }));
      await screen.findByText("This result was generated but could not be saved to history.");

      await user.selectOptions(screen.getByLabelText("Workspace"), "research-brief");

      expect(
        screen.queryByText("This result was generated but could not be saved to history.")
      ).not.toBeInTheDocument();
    });
  });
});
