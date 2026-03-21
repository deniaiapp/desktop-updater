import { Hono } from "hono";
import type { Context } from "hono";

const app = new Hono();

const GITHUB_API_BASE = "https://api.github.com";
const REPO = "deniaiapp/desktop";
const CACHE_TTL_MS = 60_000;

type Channel = "stable" | "canary";

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: ReleaseAsset[];
};

type PlatformUpdate = {
  signature: string;
  url: string;
};

type PlatformDefinition = {
  target: string;
  matchers: RegExp[];
};

type UpdaterManifest = {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, PlatformUpdate>;
};

type CacheEntry = {
  expiresAt: number;
  releases: GitHubRelease[];
};

const cache = new Map<string, CacheEntry>();

const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    target: "darwin-aarch64",
    matchers: [/darwin_(aarch64|arm64)\.app\.tar\.gz$/i],
  },
  {
    target: "darwin-aarch64-app",
    matchers: [/darwin_(aarch64|arm64)\.app\.tar\.gz$/i],
  },
  {
    target: "darwin-x86_64",
    matchers: [/darwin_(x64|x86_64)\.app\.tar\.gz$/i],
  },
  {
    target: "darwin-x86_64-app",
    matchers: [/darwin_(x64|x86_64)\.app\.tar\.gz$/i],
  },
  {
    target: "linux-aarch64",
    matchers: [/linux_aarch64\.AppImage$/i, /linux_arm64\.AppImage$/i],
  },
  {
    target: "linux-aarch64-appimage",
    matchers: [/linux_aarch64\.AppImage$/i, /linux_arm64\.AppImage$/i],
  },
  {
    target: "linux-aarch64-deb",
    matchers: [/linux_arm64\.deb$/i, /linux_aarch64\.deb$/i],
  },
  {
    target: "linux-aarch64-rpm",
    matchers: [/linux_aarch64\.rpm$/i, /linux_arm64\.rpm$/i],
  },
  {
    target: "linux-x86_64",
    matchers: [/linux_(amd64|x64|x86_64)\.AppImage$/i],
  },
  {
    target: "linux-x86_64-appimage",
    matchers: [/linux_(amd64|x64|x86_64)\.AppImage$/i],
  },
  {
    target: "linux-x86_64-deb",
    matchers: [/linux_(amd64|x64|x86_64)\.deb$/i],
  },
  {
    target: "linux-x86_64-rpm",
    matchers: [/linux_(amd64|x64|x86_64)\.rpm$/i],
  },
  {
    target: "windows-aarch64",
    matchers: [/windows_arm64-setup\.exe$/i, /windows_arm64\.msi$/i],
  },
  {
    target: "windows-aarch64-msi",
    matchers: [/windows_arm64\.msi$/i],
  },
  {
    target: "windows-aarch64-nsis",
    matchers: [/windows_arm64-setup\.exe$/i],
  },
  {
    target: "windows-x86_64",
    matchers: [/windows_(amd64|x64|x86_64)\.msi$/i],
  },
  {
    target: "windows-x86_64-msi",
    matchers: [/windows_(amd64|x64|x86_64)\.msi$/i],
  },
  {
    target: "windows-x86_64-nsis",
    matchers: [/windows_(amd64|x64|x86_64)-setup\.exe$/i],
  },
];

function githubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "deni-ai-desktop-updater",
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchReleases(): Promise<GitHubRelease[]> {
  const cacheKey = "releases";
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return hit.releases;
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${REPO}/releases?per_page=20`,
    { headers: githubHeaders() },
  );

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  const releases = (await response.json()) as GitHubRelease[];
  cache.set(cacheKey, { releases, expiresAt: now + CACHE_TTL_MS });
  return releases;
}

function selectRelease(releases: GitHubRelease[], channel: Channel) {
  return releases.find((release) => {
    if (release.draft) return false;
    if (channel === "stable") return !release.prerelease;
    return true;
  });
}

function normalizeVersion(tagName: string) {
  return tagName.startsWith("v") ? tagName.slice(1) : tagName;
}

function findSignatureAsset(
  assets: ReleaseAsset[],
  assetName: string,
): ReleaseAsset | undefined {
  return assets.find((candidate) => candidate.name === `${assetName}.sig`);
}

function findAsset(assets: ReleaseAsset[], assetName: string): ReleaseAsset | undefined {
  return assets.find((candidate) => candidate.name === assetName);
}

async function fetchSignature(asset: ReleaseAsset): Promise<string> {
  const response = await fetch(asset.browser_download_url, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Signature download failed with ${response.status}`);
  }

  return (await response.text()).trim();
}

function isUpdaterManifest(value: unknown): value is UpdaterManifest {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<UpdaterManifest>;
  return (
    typeof candidate.version === "string" &&
    !!candidate.version &&
    !!candidate.platforms &&
    typeof candidate.platforms === "object"
  );
}

async function fetchLatestJsonAsset(
  assets: ReleaseAsset[],
): Promise<UpdaterManifest | null> {
  const latestJsonAsset = findAsset(assets, "latest.json");
  if (!latestJsonAsset) return null;

  const response = await fetch(latestJsonAsset.browser_download_url, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`latest.json download failed with ${response.status}`);
  }

  const manifest = (await response.json()) as unknown;
  if (!isUpdaterManifest(manifest)) {
    throw new Error("latest.json is missing required updater fields");
  }

  return manifest;
}

async function buildManifest(
  release: GitHubRelease,
): Promise<UpdaterManifest | null> {
  const latestJsonManifest = await fetchLatestJsonAsset(release.assets);
  if (latestJsonManifest) {
    return latestJsonManifest;
  }

  const platforms: Record<string, PlatformUpdate> = {};

  for (const { target, matchers } of PLATFORM_DEFINITIONS) {
    const asset = release.assets.find((candidate) =>
      matchers.some((matcher) => matcher.test(candidate.name)),
    );

    if (!asset) continue;

    const signatureAsset = findSignatureAsset(release.assets, asset.name);
    if (!signatureAsset) continue;

    platforms[target] = {
      signature: await fetchSignature(signatureAsset),
      url: asset.browser_download_url,
    };
  }

  if (Object.keys(platforms).length === 0) {
    return null;
  }

  return {
    version: normalizeVersion(release.tag_name),
    notes: release.body ?? undefined,
    pub_date: release.published_at ?? undefined,
    platforms,
  };
}

async function findManifestForChannel(
  releases: GitHubRelease[],
  channel: Channel,
): Promise<{ manifest: UpdaterManifest; release: GitHubRelease } | null> {
  for (const release of releases) {
    if (release.draft) continue;
    if (channel === "stable" && release.prerelease) continue;

    const manifest = await buildManifest(release);
    if (manifest) {
      return { manifest, release };
    }
  }

  return null;
}

function jsonError(
  c: Context,
  status: 404 | 502,
  error: string,
  detail?: string,
) {
  return c.json(
    {
      error,
      detail,
    },
    status,
  );
}

app.get("/", (c) => {
  return c.json({
    service: "deni-ai-desktop-updater",
    repo: REPO,
    endpoints: ["/stable/latest.json", "/canary/latest.json", "/healthz"],
  });
});

app.get("/healthz", (c) => c.text("ok"));

app.get("/:channel/latest.json", async (c) => {
  const channel = c.req.param("channel");
  if (channel !== "stable" && channel !== "canary") {
    return jsonError(c, 404, "not_found");
  }

  try {
    const releases = await fetchReleases();
    const release = selectRelease(releases, channel);

    if (!release) {
      return jsonError(
        c,
        404,
        "release_not_found",
        channel === "stable"
          ? "No published stable release exists in deniaiapp/desktop."
          : "No published release exists in deniaiapp/desktop.",
      );
    }

    const resolved = await findManifestForChannel(releases, channel);
    if (!resolved) {
      return jsonError(
        c,
        404,
        "updater_artifacts_missing",
        `No published ${channel} release contains a valid Tauri updater manifest.`,
      );
    }

    return c.json(resolved.manifest);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    return jsonError(c, 502, "upstream_error", detail);
  }
});

export default app;
