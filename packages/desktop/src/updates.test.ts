import { describe, expect, it } from "vitest";
import { DESKTOP_PUBLISH, DESKTOP_TAG_PREFIX, checkForDesktopUpdate, pickDesktopUpdateFromJson } from "./updates.js";

const cli = (tag: string) => ({
  tag_name: tag,
  html_url: `https://github.com/cgold9820-dotcom/Flowgit/releases/tag/${tag}`,
});

describe("desktop updates", () => {
  it("never treats a CLI v* release as a desktop update", async () => {
    const body = [
      cli("v0.1.0"),
      cli("v9.9.9"),
      { ...cli("desktop-v0.2.0"), draft: true },
      { ...cli("desktop-v0.1.1"), prerelease: true },
      cli("desktop-v0.1.0"),
      { tag_name: "not-a-release", html_url: "https://example.com/nope" },
    ];
    expect(pickDesktopUpdateFromJson(body, "0.1.0")).toBeNull();
    expect(DESKTOP_PUBLISH.tagNamePrefix).toBe(DESKTOP_TAG_PREFIX);
    expect(DESKTOP_PUBLISH.tagNamePrefix).not.toBe("v");

    const newer = pickDesktopUpdateFromJson([...body, cli("desktop-v0.3.0"), cli("desktop-v0.2.1")], "0.1.0");
    expect(newer).toEqual({
      tag: "desktop-v0.3.0",
      version: "0.3.0",
      url: "https://github.com/cgold9820-dotcom/Flowgit/releases/tag/desktop-v0.3.0",
    });

    const fetched = await checkForDesktopUpdate("0.1.0", async () => ({
      ok: true,
      json: async () => [cli("v1.0.0"), cli("desktop-v0.1.0")],
    }) as Response);
    expect(fetched).toBeNull();
  });

  it("ignores a response that is not a release list", () => {
    expect(pickDesktopUpdateFromJson({ tag_name: "v1.0.0" }, "0.1.0")).toBeNull();
    expect(pickDesktopUpdateFromJson("v1.0.0", "0.1.0")).toBeNull();
  });
});
