import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.js";

/**
 * fetch is mocked at the module boundary (api/runWorkspace.ts is the only
 * module that calls it) — no real network socket, no real Express server,
 * no Anthropic key. See docs/milestones/M3_DESIGN.md Section 3.
 */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the page heading and labeled input", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Job Application Review" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your response")).toBeInTheDocument();
  });

  it("shows the review empty state before any submission", () => {
    render(<App />);

    expect(
      screen.getByText("Your review will appear here after you submit a response.")
    ).toBeInTheDocument();
  });

  it("disables submission for empty input", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "Review response" })).toBeDisabled();
  });

  it("disables submission for whitespace-only input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Your response"), "   ");

    expect(screen.getByRole("button", { name: "Review response" })).toBeDisabled();
  });

  it("sends the exact workspaceId and input on a valid submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { output: "Strong: ..." }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Your response"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/runs");
    expect(options.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(options.body as string)).toEqual({
      workspaceId: "job-application-review",
      input: "I led the migration.",
    });
  });

  it("disables the button while a request is in flight, preventing duplicate submission", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Your response"), "I led the migration.");
    const button = screen.getByRole("button", { name: "Review response" });
    await user.click(button);

    expect(screen.getByRole("button", { name: "Reviewing…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reviewing…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(200, { output: "done" }));
    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
  });

  it("renders successful output, preserving whitespace", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { output: "Strong\n\nClear and specific." }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Your response"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    const output = await screen.findByText("Clear and specific.", { exact: false });
    expect(output).toBeInTheDocument();
    expect(output.textContent).toBe("Strong\n\nClear and specific.");
  });

  it("displays the safe message from a structured API error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(404, {
        error: { code: "WORKSPACE_NOT_FOUND", message: "No workspace found.", retryable: false },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Your response"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No workspace found.");
  });

  it("displays a generic safe message for a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Your response"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
    expect(alert.textContent).not.toContain("network down");
  });

  it("displays a generic safe message for a malformed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Your response"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again."
    );
  });

  it("renders model output as text, not injected HTML", async () => {
    const maliciousOutput = "<img src=x onerror=alert(1)>Strong section";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { output: maliciousOutput }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.type(screen.getByLabelText("Your response"), "I led the migration.");
    await user.click(screen.getByRole("button", { name: "Review response" }));

    await waitFor(() => expect(screen.queryByText(/Strong section/)).toBeInTheDocument());
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(maliciousOutput, { exact: false })).toBeInTheDocument();
  });
});
