import { describe, expect, it } from "vite-plus/test";

import { parseAntigravityUsage } from "./AntigravityQuota.ts";

describe("parseAntigravityUsage", () => {
  it("reads the structured usage response and keeps the two quota groups", () => {
    const result = parseAntigravityUsage(
      JSON.stringify({
        response: "ignored",
        command: {
          data: {
            groups: [
              {
                name: "Gemini Models",
                buckets: [
                  {
                    name: "Weekly Limit Remaining",
                    window: "weekly",
                    remaining_fraction: 0.91,
                    reset_time: "2026-09-11T00:33:37Z",
                  },
                  {
                    name: "Five Hour Limit Remaining",
                    window: "5h",
                    remaining_fraction: 0.93,
                    reset_time: "2026-09-05T13:31:09Z",
                  },
                ],
              },
              {
                name: "Claude and GPT models",
                buckets: [
                  {
                    name: "Weekly Limit Remaining",
                    window: "weekly",
                    remaining_fraction: 0,
                    reset_time: "2026-09-09T00:59:57Z",
                  },
                  {
                    name: "Five Hour Limit Remaining",
                    window: "5h",
                    disabled: true,
                  },
                ],
              },
            ],
          },
        },
      }),
    );

    expect(result).toEqual({
      groups: [
        {
          key: "gemini",
          displayName: "Gemini Models",
          windows: [
            {
              label: "Weekly Limit",
              usedPercent: 9,
              windowDurationMins: 10_080,
              resetsAt: "2026-09-11T00:33:37Z",
            },
            {
              label: "Five Hour Limit",
              usedPercent: 7,
              windowDurationMins: 300,
              resetsAt: "2026-09-05T13:31:09Z",
            },
          ],
        },
        {
          key: "claude-gpt",
          displayName: "Claude and GPT models",
          windows: [
            {
              label: "Weekly Limit",
              usedPercent: 100,
              windowDurationMins: 10_080,
              resetsAt: "2026-09-09T00:59:57Z",
            },
          ],
        },
      ],
    });
  });

  it("accepts the older tab-separated output", () => {
    const result = parseAntigravityUsage(
      [
        "Gemini Models\tWeekly Limit Remaining\t91%\t2026-09-11T00:33:37Z",
        "Gemini Models\tFive Hour Limit Remaining\t93%\t2026-09-05T13:31:09Z",
      ].join("\n"),
    );

    expect(result?.groups[0]?.windows.map((window) => window.usedPercent)).toEqual([9, 7]);
  });
});
