import { describe, expect, it } from "@effect/vitest";

import {
  antigravityIsolationCaveats,
  makeAntigravityContinuationGroupKey,
  makeAntigravityEnvironment,
  resolveAntigravityProfileDir,
} from "./AntigravityHome.ts";

const realHome = "/home/real";

const baseEnv: NodeJS.ProcessEnv = {
  HOME: realHome,
  USERPROFILE: "C:\\Users\\real",
  APPDATA: "C:\\Users\\real\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\real\\AppData\\Local",
  PATH: "/usr/bin",
};

describe("resolveAntigravityProfileDir", () => {
  it("is undefined when no profile is configured", () => {
    expect(resolveAntigravityProfileDir({ profileDir: "" })).toBeUndefined();
    expect(resolveAntigravityProfileDir({ profileDir: "   " })).toBeUndefined();
  });

  it("resolves to an absolute path", () => {
    const resolved = resolveAntigravityProfileDir({ profileDir: "/tmp/gemini-1" });
    expect(resolved).toBe("/tmp/gemini-1");
  });
});

describe("makeAntigravityEnvironment", () => {
  it("returns the base environment untouched for the default account", () => {
    expect(makeAntigravityEnvironment({ profileDir: "" }, baseEnv)).toBe(baseEnv);
  });

  describe("windows", () => {
    const env = makeAntigravityEnvironment({ profileDir: "/profiles/gemini-1" }, baseEnv, {
      platform: "win32",
      realHome,
    });

    it("isolates the account through USERPROFILE", () => {
      expect(env["USERPROFILE"]).toBe("/profiles/gemini-1");
    });

    it("keeps HOME on the real profile so git does not follow agy", () => {
      expect(env["HOME"]).toBe(realHome);
    });

    it("keeps APPDATA and LOCALAPPDATA on the real profile", () => {
      expect(env["APPDATA"]).toBe(baseEnv["APPDATA"]);
      expect(env["LOCALAPPDATA"]).toBe(baseEnv["LOCALAPPDATA"]);
    });

    it("pins git identity back, which is what breaks first when it is not", () => {
      expect(env["GIT_CONFIG_GLOBAL"]).toBe("/home/real/.gitconfig");
    });

    it("leaves unrelated variables alone", () => {
      expect(env["PATH"]).toBe("/usr/bin");
    });
  });

  describe("posix", () => {
    const env = makeAntigravityEnvironment({ profileDir: "/profiles/gemini-2" }, baseEnv, {
      platform: "linux",
      realHome,
    });

    it("isolates through HOME, the only selector agy honours", () => {
      expect(env["HOME"]).toBe("/profiles/gemini-2");
    });

    it("pins git identity back to the real home", () => {
      expect(env["GIT_CONFIG_GLOBAL"]).toBe("/home/real/.gitconfig");
    });

    it("keeps the npm cache on the real home", () => {
      expect(env["npm_config_cache"]).toBe("/home/real/.npm");
    });
  });

  it("does not override an explicit GIT_CONFIG_GLOBAL the user already set", () => {
    const env = makeAntigravityEnvironment(
      { profileDir: "/profiles/gemini-1" },
      { ...baseEnv, GIT_CONFIG_GLOBAL: "/etc/shared.gitconfig" },
      { platform: "linux", realHome },
    );
    expect(env["GIT_CONFIG_GLOBAL"]).toBe("/etc/shared.gitconfig");
  });

  it("never leaves both home variables pointed at the profile on windows", () => {
    // The precise regression from the previous fork: HOME and USERPROFILE both
    // redirected, so every child process followed agy into the profile.
    const env = makeAntigravityEnvironment({ profileDir: "/profiles/gemini-1" }, baseEnv, {
      platform: "win32",
      realHome,
    });
    expect([env["HOME"], env["USERPROFILE"]]).not.toEqual([
      "/profiles/gemini-1",
      "/profiles/gemini-1",
    ]);
  });
});

describe("antigravityIsolationCaveats", () => {
  it("reports nothing for the default account", () => {
    expect(antigravityIsolationCaveats({ profileDir: "" })).toEqual([]);
  });

  it("reports nothing on windows, where isolation is clean", () => {
    expect(
      antigravityIsolationCaveats({ profileDir: "/profiles/gemini-1" }, { platform: "win32" }),
    ).toEqual([]);
  });

  it("states the ssh limitation on posix instead of hiding it", () => {
    const caveats = antigravityIsolationCaveats(
      { profileDir: "/profiles/gemini-1" },
      { platform: "linux" },
    );
    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toContain("SSH");
  });
});

describe("makeAntigravityContinuationGroupKey", () => {
  it("groups two instances pointed at the same profile", () => {
    const a = makeAntigravityContinuationGroupKey({ profileDir: "/profiles/gemini-1" });
    const b = makeAntigravityContinuationGroupKey({ profileDir: "/profiles/gemini-1/" });
    expect(a).toBe(b);
  });

  it("separates different logins, which cannot resume each other's history", () => {
    const a = makeAntigravityContinuationGroupKey({ profileDir: "/profiles/gemini-1" });
    const b = makeAntigravityContinuationGroupKey({ profileDir: "/profiles/gemini-2" });
    expect(a).not.toBe(b);
  });

  it("falls back to the real home for the default account", () => {
    expect(
      makeAntigravityContinuationGroupKey({ profileDir: "" }, { realHome: "/home/real" }),
    ).toBe("antigravity:profile:/home/real");
  });
});
