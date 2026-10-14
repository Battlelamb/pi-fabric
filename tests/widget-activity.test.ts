import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { projectAgentTranscript, type FabricAgentTranscript } from "../src/ui/transcript.js";
import type { FabricDashboardSnapshot, FabricUiAgent } from "../src/ui/types.js";
import { FabricWidget, type FabricWidgetRow } from "../src/ui/widget.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
} as unknown as Theme;

const agent = (id: string, name: string, status = "running"): FabricUiAgent => ({
  id,
  name,
  status,
  transport: "process",
  cwd: "/tmp",
  startedAt: Date.now() - 5_000,
  toolCalls: 1,
});

const snapshot = (): FabricDashboardSnapshot => {
  const now = Date.now();
  return {
    now,
    main: { ...agent("main", "main"), status: "idle" },
    peers: [],
    runs: [],
    agents: [agent("agent-1", "security-reviewer")],
    actors: [
      {
        id: "actor-1",
        scope: "project",
        name: "advisor",
        status: "running",
        worker: agent("worker-1", "advisor-worker"),
        instructions: "",
        recentMessages: [],
      },
    ],
    componentGraph: { nodes: [], edges: [] },
    globalActors: [],
    state: [],
    events: [],
  } as unknown as FabricDashboardSnapshot;
};

const transcript = (): FabricAgentTranscript =>
  projectAgentTranscript([
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Checking the " } },
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "new branch state" } },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "src/a.ts" } },
  ]);

const setup = () => {
  const current = snapshot();
  const reads: FabricWidgetRow[] = [];
  let released = 0;
  const widget = new FabricWidget(theme, () => current, 6, () => 40, undefined, {
    activity: (row) => {
      reads.push(row);
      return transcript();
    },
    release: () => {
      released++;
      widget.focused = false;
    },
    requestRender: () => {},
  });
  return { widget, reads, released: () => released };
};

describe("Fabric widget activity expansion", () => {
  it("keeps thinking text from streamed worker deltas", () => {
    const entries = transcript().entries;
    const thinking = entries.find((entry) => entry.kind === "thinking");
    expect(thinking?.text).toBe("Checking the new branch state");
    expect(entries.some((entry) => entry.kind === "tool" && entry.toolName === "read")).toBe(true);
  });

  it("expands the selected participant inline and collapses it again from the keyboard", () => {
    const { widget, reads } = setup();
    const collapsed = widget.render(100);
    expect(collapsed.join("\n")).toContain("ctrl+shift+e expand");

    widget.focused = true;
    widget.selectDefault();
    widget.handleInput("\x1b[B"); // down: agent row → advisor actor row
    widget.handleInput("\r");
    expect(widget.expandedId).toBe("actor-1");
    const expanded = widget.render(100).join("\n");
    expect(reads.at(-1)).toMatchObject({ id: "actor-1", kind: "actor" });
    expect(expanded).toContain("advisor activity");
    expect(expanded).toContain("thinking");
    expect(expanded).toContain("new branch state");
    expect(expanded).toContain("read");

    widget.handleInput("\r");
    expect(widget.expandedId).toBeUndefined();
    expect(widget.render(100).join("\n")).not.toContain("advisor activity");
  });

  it("Esc collapses first, then releases focus to the editor", () => {
    const { widget, released } = setup();
    widget.focused = true;
    widget.selectDefault();
    widget.handleInput("\r");
    expect(widget.expandedId).toBe("agent-1");
    widget.handleInput("\x1b");
    expect(widget.expandedId).toBeUndefined();
    expect(released()).toBe(0);
    widget.handleInput("\x1b");
    expect(released()).toBe(1);
  });

  it("a click on a participant row focuses the widget and toggles its pane", () => {
    const { widget } = setup();
    const lines = widget.render(100);
    const advisorLine = lines.findIndex((line) => line.includes("advisor"));
    expect(advisorLine).toBeGreaterThan(0);
    const click = { type: "click", button: "left", x: 4, y: advisorLine, screenX: 4, screenY: advisorLine, width: 100, height: lines.length, shift: false, alt: false, ctrl: false } as const;
    expect(widget.handleMouse(click)).toMatchObject({ focus: true });
    expect(widget.expandedId).toBe("actor-1");
    widget.render(100);
    widget.handleMouse(click);
    expect(widget.expandedId).toBeUndefined();
  });

  it("keeps every expanded line inside the width", () => {
    const { widget } = setup();
    widget.focused = true;
    widget.selectDefault();
    widget.handleInput("\r");
    for (const width of [30, 60, 120]) {
      expect(widget.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("stays passive without interaction wiring", () => {
    const current = snapshot();
    const widget = new FabricWidget(theme, () => current, 6);
    expect(widget.render(100).join("\n")).not.toContain("expand");
    expect(widget.handleMouse({ type: "click", button: "left", x: 0, y: 1, screenX: 0, screenY: 1, width: 100, height: 3, shift: false, alt: false, ctrl: false })).toBeUndefined();
  });
});
