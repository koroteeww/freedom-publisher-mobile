import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Base64 } from "js-base64";

type PlatformLinks = {
  tiktok?: string;
  instagram?: string;
  youtube?: string;
  x?: string;
};

type Settings = {
  sourceAlbumsCsv: string;
  doneAlbumName: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  githubToken: string;
  githubLogPath: string;
  dayTitle: string;
};

type ClipStatus = {
  assetId: string;
  albumTitle: string;
  albumId?: string;
  filename: string;
  caption: string;
  links: PlatformLinks;
  done: boolean;
};

type QueueItem = {
  asset: MediaLibrary.Asset;
  albumTitle: string;
  albumId?: string;
  status: ClipStatus;
};

type LogItem = {
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
};

const SETTINGS_KEY = "freedom_publisher_settings_v1";
const STATUSES_KEY = "freedom_publisher_statuses_v1";

const DEFAULT_SETTINGS: Settings = {
  sourceAlbumsCsv: "FreedomClips_EN,FreedomClips_HI,FreedomClips_FR,FreedomClips_TR",
  doneAlbumName: "FreedomClips_Done",
  githubOwner: "koroteeww",
  githubRepo: "freedom-clips-ai",
  githubBranch: "main",
  githubToken: "",
  githubLogPath: "publishingLOG/day2.md",
  dayTitle: "Day 002 — Publishing Log",
};

function splitAlbums(csv: string): string[] {
  return csv
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function nowTime(): string {
  return new Date().toLocaleTimeString();
}

function shortJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatError(e: unknown): string {
  if (e instanceof Error) {
    return `${e.name}: ${e.message}${e.stack ? "\n" + e.stack : ""}`;
  }
  return shortJson(e);
}

function inferLang(album: string, filename: string): string {
  const s = `${album}_${filename}`.toUpperCase();

  if (s.includes("_HI") || s.includes("HINDI")) return "HI";
  if (s.includes("_EN") || s.includes("ENGLISH")) return "EN";
  if (s.includes("_FR") || s.includes("FRENCH")) return "FR";
  if (s.includes("_TR") || s.includes("TURKISH")) return "TR";
  if (s.includes("_ES") || s.includes("SPANISH")) return "ES";
  if (s.includes("_AR") || s.includes("ARABIC")) return "AR";
  if (s.includes("_ZH") || s.includes("CHINESE")) return "ZH";

  return "UNK";
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/^D\d+_\d+_[A-Z]{2}_?/i, "")
    .replace(/^montage_\d+_\d+_/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeCaption(album: string, filename: string): string {
  const lang = inferLang(album, filename);
  const title = titleFromFilename(filename);

  return `${title}

#DigitalFreedom #PavelDurov #Telegram #Privacy #FreedomClipsAI #${lang}Shorts`;
}

async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
}

async function saveSettings(s: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

async function loadStatuses(): Promise<Record<string, ClipStatus>> {
  const raw = await AsyncStorage.getItem(STATUSES_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function saveStatuses(s: Record<string, ClipStatus>): Promise<void> {
  await AsyncStorage.setItem(STATUSES_KEY, JSON.stringify(s));
}

function isPublished(s: ClipStatus): boolean {
  return Boolean(s.links.tiktok || s.links.instagram || s.links.youtube || s.links.x);
}

function allFourLinks(s: ClipStatus): boolean {
  return Boolean(s.links.tiktok && s.links.instagram && s.links.youtube && s.links.x);
}

function buildMarkdown(statuses: ClipStatus[], settings: Settings): string {
  const rows = statuses
    .filter((x) => x.done || isPublished(x))
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map((x, i) => {
      const lang = inferLang(x.albumTitle, x.filename);
      return `| ${i + 1} | ${x.filename} | ${lang} | ${x.links.tiktok || ""} | ${x.links.instagram || ""} | ${x.links.youtube || ""} | ${x.links.x || ""} | ${x.done ? "✅" : "⏳"} |`;
    });

  const published = statuses.filter((x) => x.done || isPublished(x));
  const languages = Array.from(
    new Set(published.map((x) => inferLang(x.albumTitle, x.filename)))
  ).join(", ");

  return `# ${settings.dayTitle}

Date: ${new Date().toISOString().slice(0, 10)}

## Published clips

| # | File | Lang | TikTok | Instagram | YouTube Shorts | X | Status |
|---|------|------|--------|-----------|----------------|---|--------|
${rows.join("\n")}

## Summary

Published records: ${published.length}  
Languages: ${languages || ""}

## Notes

- Best hook:
- Best platform response:
- Problems:
- Tomorrow:
`;
}
//github edits
function githubPathForUrl(path: string): string {
  return path
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function githubHeaders(settings: Settings): Record<string, string> {
  return {
    Authorization: `Bearer ${settings.githubToken.trim()}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readResponseText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function getGithubFileSha(settings: Settings): Promise<string | null> {
  if (!settings.githubToken.trim()) {
    throw new Error("GitHub token is empty. Open Settings and paste fine-grained PAT.");
  }

  const path = githubPathForUrl(settings.githubLogPath);
  const branch = encodeURIComponent(settings.githubBranch.trim() || "main");

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(settings.githubOwner.trim())}/` +
    `${encodeURIComponent(settings.githubRepo.trim())}/` +
    `contents/${path}?ref=${branch}`;

  const res = await fetch(url, {
    method: "GET",
    headers: githubHeaders(settings),
  });

  const text = await readResponseText(res);

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`GitHub GET failed: ${res.status} ${text}`);
  }

  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GitHub GET returned non-JSON response: ${text.slice(0, 500)}`);
  }

  if (Array.isArray(json)) {
    throw new Error(
      `GitHub path points to a directory, not a file: ${settings.githubLogPath}`
    );
  }

  if (json.type && json.type !== "file") {
    throw new Error(
      `GitHub path is not a file. type=${json.type}, path=${settings.githubLogPath}`
    );
  }

  if (!json.sha) {
    throw new Error(
      `GitHub file exists but response has no sha. Response: ${JSON.stringify(json).slice(0, 800)}`
    );
  }

  return json.sha;
}

async function putGithubMarkdownOnce(
  settings: Settings,
  markdown: string,
  sha: string | null
): Promise<{ ok: true } | { ok: false; status: number; text: string }> {
  const path = githubPathForUrl(settings.githubLogPath);

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(settings.githubOwner.trim())}/` +
    `${encodeURIComponent(settings.githubRepo.trim())}/` +
    `contents/${path}`;

  const body: any = {
    message: `Update ${settings.githubLogPath}`,
    content: Base64.encode(markdown),
    branch: settings.githubBranch.trim() || "main",
  };

  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(settings),
    body: JSON.stringify(body),
  });

  const text = await readResponseText(res);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      text,
    };
  }

  return { ok: true };
}

async function updateGithubMarkdown(settings: Settings, markdown: string): Promise<void> {
  if (!settings.githubToken.trim()) {
    throw new Error("GitHub token is empty. Open Settings and paste fine-grained PAT.");
  }

  const initialSha = await getGithubFileSha(settings);
  const firstTry = await putGithubMarkdownOnce(settings, markdown, initialSha);

  if (firstTry.ok) {
    return;
  }

  const missingSha =
    firstTry.status === 422 &&
    firstTry.text.includes("sha") &&
    firstTry.text.includes("wasn't supplied");

  if (missingSha) {
    /*
      GitHub says the file exists, but our first SHA fetch did not attach it.
      Fetch SHA again and retry once.
    */
    const retrySha = await getGithubFileSha(settings);

    if (!retrySha) {
      throw new Error(
        `GitHub says file exists and requires sha, but GET returned no sha. ` +
          `Check path="${settings.githubLogPath}", branch="${settings.githubBranch}". ` +
          `Original PUT error: ${firstTry.status} ${firstTry.text}`
      );
    }

    const secondTry = await putGithubMarkdownOnce(settings, markdown, retrySha);

    if (secondTry.ok) {
      return;
    }

    throw new Error(
      `GitHub PUT retry with sha failed: ${secondTry.status} ${secondTry.text}`
    );
  }

  throw new Error(`GitHub PUT failed: ${firstTry.status} ${firstTry.text}`);
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [statuses, setStatuses] = useState<Record<string, ClipStatus>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([
    { ts: nowTime(), level: "info", msg: "App started" },
  ]);

  function addLog(msg: string, level: LogItem["level"] = "info") {
    console.log(`[FreedomPublisher][${level}] ${msg}`);
    setLogs((prev) => [{ ts: nowTime(), level, msg }, ...prev].slice(0, 250));
  }

  async function withTimeout<T>(label: string, promise: Promise<T>, ms = 20000): Promise<T> {
    addLog(`START: ${label}`);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`TIMEOUT after ${ms}ms: ${label}`));
      }, ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      addLog(`OK: ${label}`);
      return result as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function persistStatuses(next: Record<string, ClipStatus>): Promise<void> {
    setStatuses(next);
    await saveStatuses(next);
  }

  async function init(): Promise<void> {
    setBusy(true);

    try {
      addLog("Init started");

      const savedSettings = await withTimeout("AsyncStorage loadSettings", loadSettings(), 8000);
      const savedStatuses = await withTimeout("AsyncStorage loadStatuses", loadStatuses(), 8000);

      setSettings(savedSettings);
      setStatuses(savedStatuses);

      addLog(`Loaded settings: sourceAlbumsCsv=${savedSettings.sourceAlbumsCsv}`);
      addLog(`Loaded statuses count: ${Object.keys(savedStatuses).length}`);

      const perm = await withTimeout(
        "MediaLibrary.requestPermissionsAsync",
        MediaLibrary.requestPermissionsAsync(),
        30000
      );

      addLog(`Permission result: ${shortJson(perm)}`);

      if (!perm.granted) {
        setStatusText("Media permission not granted");
        Alert.alert("Permission needed", "Media library permission is required.");
        return;
      }

      await refreshQueue(savedSettings, savedStatuses);
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      setStatusText("Init failed. Check debug log.");
      Alert.alert("Init error", msg.slice(0, 1200));
    } finally {
      setBusy(false);
    }
  }

  async function getAlbumVideosSafe(album: any): Promise<MediaLibrary.Asset[]> {
    try {
      const page = await withTimeout(
        `getAssetsAsync album=${album.title} with sort`,
        MediaLibrary.getAssetsAsync({
          album,
          mediaType: "video" as any,
          first: 50,
          sortBy: [MediaLibrary.SortBy.creationTime],
        }),
        20000
      );

      return page.assets;
    } catch (e) {
      addLog(`getAssets with sort failed for ${album.title}: ${formatError(e)}`, "warn");
      addLog(`Retrying ${album.title} without sortBy...`, "warn");

      const page = await withTimeout(
        `getAssetsAsync album=${album.title} no sort`,
        MediaLibrary.getAssetsAsync({
          album,
          mediaType: "video" as any,
          first: 50,
        }),
        20000
      );

      return page.assets;
    }
  }

  async function listAlbumsOnly(): Promise<void> {
    setBusy(true);

    try {
      addLog("Manual List albums clicked");

      const perm = await withTimeout(
        "MediaLibrary.getPermissionsAsync",
        MediaLibrary.getPermissionsAsync(),
        10000
      );

      addLog(`Current permission: ${shortJson(perm)}`);

      if (!perm.granted) {
        addLog("Permission not granted. Requesting again...", "warn");
        const requested = await withTimeout(
          "MediaLibrary.requestPermissionsAsync",
          MediaLibrary.requestPermissionsAsync(),
          30000
        );
        addLog(`Permission after request: ${shortJson(requested)}`);
      }

      const albums = await withTimeout(
        "MediaLibrary.getAlbumsAsync",
        MediaLibrary.getAlbumsAsync(),
        30000
      );

      addLog(`Albums found: ${albums.length}`);

      if (albums.length === 0) {
        addLog("No albums returned by MediaLibrary. Android permission may be limited.", "warn");
      }

      albums.slice(0, 100).forEach((a: any, i: number) => {
        addLog(`#${i + 1}: "${a.title}" id=${a.id} assetCount=${a.assetCount}`);
      });

      setStatusText(`Albums found: ${albums.length}`);
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      setStatusText("List albums failed. Check debug log.");
      Alert.alert("List albums error", msg.slice(0, 1200));
    } finally {
      setBusy(false);
    }
  }

  async function refreshQueue(
    currentSettings: Settings = settings,
    currentStatuses: Record<string, ClipStatus> = statuses
  ): Promise<void> {
    setBusy(true);
    setStatusText("Scanning albums...");

    try {
      addLog("Refresh queue started");

      const sourceAlbumTitles = splitAlbums(currentSettings.sourceAlbumsCsv);
      addLog(`Source albums wanted: ${sourceAlbumTitles.join(" | ") || "(empty)"}`);

      if (sourceAlbumTitles.length === 0) {
        addLog("No source albums configured.", "warn");
        setQueue([]);
        setStatusText("No source albums configured");
        return;
      }

      const albums = await withTimeout(
        "MediaLibrary.getAlbumsAsync",
        MediaLibrary.getAlbumsAsync(),
        30000
      );

      addLog(`MediaLibrary albums count: ${albums.length}`);
      addLog(
        `Available albums: ${albums
          .slice(0, 50)
          .map((a: any) => `"${a.title}"(${a.assetCount})`)
          .join(", ")}`
      );

      const nextStatuses = { ...currentStatuses };
      const nextQueue: QueueItem[] = [];

      for (const albumTitle of sourceAlbumTitles) {
        addLog(`Scanning configured album: "${albumTitle}"`);

        const exactAlbum: any | undefined = albums.find((a: any) => a.title === albumTitle);
        const caseInsensitiveAlbum: any | undefined = albums.find(
          (a: any) => String(a.title).trim().toLowerCase() === albumTitle.trim().toLowerCase()
        );

        const album: any | undefined = exactAlbum || caseInsensitiveAlbum;

        if (!album) {
          addLog(`Album NOT FOUND: "${albumTitle}"`, "warn");
          continue;
        }

        addLog(`Album matched: "${album.title}" id=${album.id} assetCount=${album.assetCount}`);

        const assets = await getAlbumVideosSafe(album);
        addLog(`Videos loaded from "${album.title}": ${assets.length}`);

        if (assets.length > 0) {
          addLog(
            `First videos in "${album.title}": ${assets
              .slice(0, 5)
              .map((x) => x.filename)
              .join(" | ")}`
          );
        }

        const firstUnfinished = assets.find((asset) => !nextStatuses[asset.id]?.done);

        if (!firstUnfinished) {
          addLog(`No unfinished videos in "${album.title}"`, "warn");
          continue;
        }

        const existing = nextStatuses[firstUnfinished.id];

        const status: ClipStatus =
          existing || {
            assetId: firstUnfinished.id,
            albumTitle: album.title,
            albumId: album.id,
            filename: firstUnfinished.filename,
            caption: makeCaption(album.title, firstUnfinished.filename),
            links: {},
            done: false,
          };

        status.albumTitle = album.title;
        status.albumId = album.id;
        status.filename = firstUnfinished.filename;

        nextStatuses[firstUnfinished.id] = status;

        nextQueue.push({
          asset: firstUnfinished,
          albumTitle: album.title,
          albumId: album.id,
          status,
        });

        addLog(`Queued: ${firstUnfinished.filename}`);
      }

      setQueue(nextQueue);
      await persistStatuses(nextStatuses);

      setStatusText(`Queue: ${nextQueue.length} video(s)`);
      addLog(`Refresh queue finished. Queue size: ${nextQueue.length}`);
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      setStatusText("Refresh failed. Check debug log.");
      Alert.alert("Refresh error", msg.slice(0, 1200));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    init();
  }, []);

  const publishedStatuses = useMemo(
    () => Object.values(statuses).filter((x) => x.done || isPublished(x)),
    [statuses]
  );

  async function copyCaption(status: ClipStatus): Promise<void> {
    try {
      await Clipboard.setStringAsync(status.caption);
      setStatusText(`Caption copied: ${status.filename}`);
      addLog(`Caption copied: ${status.filename}`);
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      Alert.alert("Clipboard error", msg.slice(0, 1200));
    }
  }

  async function shareVideo(asset: MediaLibrary.Asset, status: ClipStatus): Promise<void> {
    try {
      addLog(`Share requested: ${status.filename}`);

      await Clipboard.setStringAsync(status.caption);
      addLog("Caption copied before sharing");

      const info = await withTimeout(
        `getAssetInfoAsync ${status.filename}`,
        MediaLibrary.getAssetInfoAsync(asset),
        20000
      );

      addLog(`Asset info: localUri=${Boolean(info.localUri)} uri=${Boolean(info.uri)} asset.uri=${Boolean(asset.uri)}`);

      const uri = info.localUri || info.uri || asset.uri;

      if (!uri) {
        throw new Error("Cannot get local video URI.");
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        throw new Error("Sharing is not available on this device.");
      }

      setStatusText("Caption copied. Opening Android share sheet...");
      addLog(`Opening share sheet for URI: ${uri.slice(0, 120)}`);

      await Sharing.shareAsync(uri, {
        mimeType: "video/mp4",
        dialogTitle: "Publish this clip",
        UTI: "public.movie",
      });

      addLog("Share sheet returned");
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      setStatusText("Share failed. Check debug log.");
      Alert.alert("Share error", msg.slice(0, 1200));
    }
  }

  async function updateCaption(assetId: string, caption: string): Promise<void> {
    const next = {
      ...statuses,
      [assetId]: {
        ...statuses[assetId],
        caption,
      },
    };

    await persistStatuses(next);
  }

  async function updateLink(
    assetId: string,
    platform: keyof PlatformLinks,
    value: string
  ): Promise<void> {
    const next = {
      ...statuses,
      [assetId]: {
        ...statuses[assetId],
        links: {
          ...statuses[assetId].links,
          [platform]: value,
        },
      },
    };

    await persistStatuses(next);
  }

  async function ensureDoneAlbum(title: string, initialAsset?: MediaLibrary.Asset): Promise<MediaLibrary.Album | null> {
    addLog(`Ensuring Done album: "${title}"`);

    const albums = await withTimeout(
      "MediaLibrary.getAlbumsAsync for Done album",
      MediaLibrary.getAlbumsAsync(),
      20000
    );

    const existing = albums.find((a: any) => a.title === title);

    if (existing) {
      addLog(`Done album exists: "${existing.title}" id=${existing.id}`);
      return existing;
    }

    if (!initialAsset) {
      addLog("Cannot create Done album without initial asset", "warn");
      return null;
    }

    addLog(`Creating Done album: "${title}"`);

    try {
      const created = await withTimeout(
        `createAlbumAsync ${title}`,
        MediaLibrary.createAlbumAsync(title, initialAsset, false),
        20000
      );

      addLog(`Created Done album: "${created.title}" id=${created.id}`);
      return created;
    } catch (e) {
      addLog(`createAlbumAsync failed: ${formatError(e)}`, "error");
      return null;
    }
  }

  async function markDoneAndMove(item: QueueItem): Promise<void> {
    const current = statuses[item.asset.id];

    if (!current) {
      addLog("markDoneAndMove: status not found", "error");
      return;
    }

    if (!allFourLinks(current)) {
      Alert.alert("Links missing", "Not all four links are filled. Mark done anyway?", [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Done", onPress: () => actuallyMarkDoneAndMove(item) },
      ]);
      return;
    }

    await actuallyMarkDoneAndMove(item);
  }

  async function actuallyMarkDoneAndMove(item: QueueItem): Promise<void> 
  {
    setBusy(true);

    try {
      addLog(`Mark done requested: ${item.status.filename}`);
      setStatusText("Marking done...");

      let copiedToDone = false;

      try {
        addLog(`Trying to copy asset to Done album: "${settings.doneAlbumName}"`);

        const doneAlbum: any = await ensureDoneAlbum(settings.doneAlbumName, item.asset);

        if (doneAlbum) {
          addLog(`Done album ready: "${doneAlbum.title}" id=${doneAlbum.id}`);

          /*
            IMPORTANT:
            Third parameter = copy.
            true  => copy asset to target album
            false => move asset to target album

            On Android, move/delete often fails with EPERM / Could not delete file.
            So we use true and DO NOT remove from source album.
          */
          await withTimeout(
            "MediaLibrary.addAssetsToAlbumAsync Done copy=true",
            MediaLibrary.addAssetsToAlbumAsync([item.asset], doneAlbum, true),
            30000
          );

          copiedToDone = true;
          addLog("Copied to Done album with copy=true");
        } else {
          addLog("Done album is null. Will mark done only.", "warn");
        }
      } catch (e) {
        addLog(
          `Copy to Done album failed, but app will still mark item done logically: ${formatError(e)}`,
          "warn"
        );
      }

      /*
        Do NOT call removeAssetsFromAlbumAsync on Android.
        It often fails with:
        - Could not delete file
        - EPERM Operation not permitted

        Instead, app tracking status is the source of truth.
        refreshQueue() already skips assets where status.done === true.
      */
      const next = {
        ...statuses,
        [item.asset.id]: {
          ...statuses[item.asset.id],
          done: true,
        },
      };

      await persistStatuses(next);
      await refreshQueue(settings, next);

      if (copiedToDone) {
        setStatusText(`Done + copied: ${item.status.filename}`);
        addLog(`Done completed with copy: ${item.status.filename}`);
      } else {
        setStatusText(`Done logically: ${item.status.filename}`);
        addLog(`Done completed logically only: ${item.status.filename}`);
      }
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      setStatusText("Mark done failed. Check debug log.");
      Alert.alert("Mark done failed", msg.slice(0, 1200));
    } finally {
      setBusy(false);
    }
  }

  async function syncGithub(): Promise<void> {
    setBusy(true);

    try {
      addLog("GitHub sync started");
      setStatusText("Generating GitHub markdown...");

      const markdown = buildMarkdown(Object.values(statuses), settings);
      addLog(`Markdown length: ${markdown.length}`);

      await withTimeout(
        `GitHub update ${settings.githubLogPath}`,
        updateGithubMarkdown(settings, markdown),
        30000
      );

      setStatusText(`GitHub synced: ${settings.githubLogPath}`);
      addLog(`GitHub synced: ${settings.githubLogPath}`);
      Alert.alert("GitHub synced", `Updated ${settings.githubLogPath}`);
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      setStatusText("GitHub sync failed. Check debug log.");
      Alert.alert("GitHub error", msg.slice(0, 1200));
    } finally {
      setBusy(false);
    }
  }

  async function copyMarkdownPreview(): Promise<void> {
    try {
      const markdown = buildMarkdown(Object.values(statuses), settings);
      await Clipboard.setStringAsync(markdown);
      addLog("Markdown log copied to clipboard");
      Alert.alert("Copied", "Markdown log copied to clipboard.");
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      Alert.alert("Copy markdown error", msg.slice(0, 1200));
    }
  }

  async function copyDebugLog(): Promise<void> {
    const text = logs
      .map((x) => `[${x.ts}] [${x.level.toUpperCase()}] ${x.msg}`)
      .join("\n");

    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", "Debug log copied to clipboard.");
  }

  async function saveSettingsFromState(): Promise<void> {
    setBusy(true);

    try {
      addLog("Saving settings...");
      await saveSettings(settings);
      addLog("Settings saved");
      Alert.alert("Saved", "Settings saved.");
      await refreshQueue(settings, statuses);
    } catch (e) {
      const msg = formatError(e);
      addLog(msg, "error");
      Alert.alert("Save settings error", msg.slice(0, 1200));
    } finally {
      setBusy(false);
    }
  }

  async function resetLocalStatuses(): Promise<void> {
    Alert.alert("Reset local statuses?", "This clears app tracking state, not videos.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem(STATUSES_KEY);
          setStatuses({});
          setQueue([]);
          addLog("Local statuses reset", "warn");
          await refreshQueue(settings, {});
        },
      },
    ]);
  }

  function renderDebugLog() {
    return (
      <View style={styles.logBox}>
        <View style={styles.logHeader}>
          <Text style={styles.logTitle}>Debug log</Text>
          <Text style={styles.logHint}>{logs.length} rows</Text>
        </View>

        <ScrollView style={styles.logScroll} nestedScrollEnabled>
          {logs.map((x, i) => (
            <Text
              key={`${x.ts}-${i}`}
              style={[
                styles.logLine,
                x.level === "error" && styles.logError,
                x.level === "warn" && styles.logWarn,
              ]}
            >
              [{x.ts}] [{x.level.toUpperCase()}] {x.msg}
            </Text>
          ))}
        </ScrollView>

        <View style={styles.row}>
          <Button title="Copy log" onPress={copyDebugLog} />
          <Button title="Clear log" onPress={() => setLogs([])} />
          <Button title="List albums" onPress={listAlbumsOnly} disabled={busy} />
        </View>
      </View>
    );
  }

  function renderQueueItem(item: QueueItem) {
    const status = statuses[item.asset.id] || item.status;
    const selected = selectedAssetId === item.asset.id;
    const lang = inferLang(item.albumTitle, status.filename);

    return (
      <View key={item.asset.id} style={styles.card}>
        <Text style={styles.album}>
          {item.albumTitle} / {lang}
        </Text>

        <Text style={styles.file}>{status.filename}</Text>

        <Text>
          Status: {status.done ? "✅ Done" : isPublished(status) ? "⏳ Links added" : "Not published"}
        </Text>

        <View style={styles.row}>
          <Button title="Copy caption" onPress={() => copyCaption(status)} />
          <Button title="Share video" onPress={() => shareVideo(item.asset, status)} />
        </View>

        <Button
          title={selected ? "Hide details" : "Edit links / caption"}
          onPress={() => setSelectedAssetId(selected ? null : item.asset.id)}
        />

        {selected && (
          <View style={styles.details}>
            <Text style={styles.label}>Caption</Text>

            <TextInput
              style={[styles.input, styles.captionInput]}
              multiline
              value={status.caption}
              onChangeText={(v) => updateCaption(item.asset.id, v)}
            />

            <Text style={styles.label}>Published links</Text>

            <Text style={styles.linkLabel}>TikTok URL</Text>
            <TextInput
              style={styles.linkInput}
              placeholder="Paste TikTok link here"
              placeholderTextColor="#777"
              value={status.links.tiktok || ""}
              onChangeText={(v) => updateLink(item.asset.id, "tiktok", v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={styles.linkLabel}>Instagram URL</Text>
            <TextInput
              style={styles.linkInput}
              placeholder="Paste Instagram / Reels link here"
              placeholderTextColor="#777"
              value={status.links.instagram || ""}
              onChangeText={(v) => updateLink(item.asset.id, "instagram", v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={styles.linkLabel}>YouTube Shorts URL</Text>
            <TextInput
              style={styles.linkInput}
              placeholder="Paste YouTube Shorts link here"
              placeholderTextColor="#777"
              value={status.links.youtube || ""}
              onChangeText={(v) => updateLink(item.asset.id, "youtube", v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Text style={styles.linkLabel}>X / Twitter URL</Text>
            <TextInput
              style={styles.linkInput}
              placeholder="Paste X / Twitter link here"
              placeholderTextColor="#777"
              value={status.links.x || ""}
              onChangeText={(v) => updateLink(item.asset.id, "x", v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Button title="Mark done / copy to Done" onPress={() => markDoneAndMove(item)} />
          </View>
        )}
      </View>
    );
  }

  if (showSettings) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView>
          <Text style={styles.title}>Settings</Text>

          <Text style={styles.label}>Source albums, comma-separated</Text>
          <TextInput
            style={styles.input}
            value={settings.sourceAlbumsCsv}
            onChangeText={(v) => setSettings({ ...settings, sourceAlbumsCsv: v })}
          />

          <Text style={styles.label}>Done album</Text>
          <TextInput
            style={styles.input}
            value={settings.doneAlbumName}
            onChangeText={(v) => setSettings({ ...settings, doneAlbumName: v })}
          />

          <Text style={styles.label}>GitHub owner</Text>
          <TextInput
            style={styles.input}
            value={settings.githubOwner}
            onChangeText={(v) => setSettings({ ...settings, githubOwner: v })}
            autoCapitalize="none"
          />

          <Text style={styles.label}>GitHub repo</Text>
          <TextInput
            style={styles.input}
            value={settings.githubRepo}
            onChangeText={(v) => setSettings({ ...settings, githubRepo: v })}
            autoCapitalize="none"
          />

          <Text style={styles.label}>GitHub branch</Text>
          <TextInput
            style={styles.input}
            value={settings.githubBranch}
            onChangeText={(v) => setSettings({ ...settings, githubBranch: v })}
            autoCapitalize="none"
          />

          <Text style={styles.label}>GitHub log path</Text>
          <TextInput
            style={styles.input}
            value={settings.githubLogPath}
            onChangeText={(v) => setSettings({ ...settings, githubLogPath: v })}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Day title</Text>
          <TextInput
            style={styles.input}
            value={settings.dayTitle}
            onChangeText={(v) => setSettings({ ...settings, dayTitle: v })}
          />

          <Text style={styles.label}>GitHub fine-grained PAT token</Text>
          <TextInput
            style={styles.input}
            value={settings.githubToken}
            onChangeText={(v) => setSettings({ ...settings, githubToken: v })}
            autoCapitalize="none"
            secureTextEntry
            placeholder="github_pat_..."
          />

          

          <View style={styles.row}>
            <Button title="Save settings" onPress={saveSettingsFromState} disabled={busy} />
            <Button title="Back to queue" onPress={() => setShowSettings(false)} />
          </View>

          <View style={styles.row}>
            <Button title="Reset local statuses" onPress={resetLocalStatuses} disabled={busy} />
            <Button title="List albums" onPress={listAlbumsOnly} disabled={busy} />
          </View>
          <Text style={styles.warning}>
            Token is stored locally with AsyncStorage. Good enough for a private personal APK MVP.
            Do not share an APK with your token configured.
          </Text>
          {renderDebugLog()}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.title}>Freedom Publisher</Text>

        <Text style={styles.status}>
          {busy ? "⏳ " : ""}
          {statusText}
        </Text>

        <View style={styles.row}>
          <Button title="Refresh queue" onPress={() => refreshQueue()} disabled={busy} />
          <Button title="Settings" onPress={() => setShowSettings(true)} />
        </View>

        <View style={styles.row}>
          <Button title="Copy MD log" onPress={copyMarkdownPreview} />
          <Button title="Sync GitHub" onPress={syncGithub} disabled={busy} />
        </View>

        {renderDebugLog()}

        <Text style={styles.subTitle}>Today queue: one video from each source album</Text>

        {queue.length === 0 ? (
          <Text style={styles.empty}>
            No videos found. Check Debug log. Most likely album names in Settings do not match Samsung Gallery album titles.
          </Text>
        ) : (
          queue.map(renderQueueItem)
        )}

        <Text style={styles.subTitle}>Tracked records: {publishedStatuses.length}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 14,
    paddingTop: 36,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 25,
    fontWeight: "800",
    marginBottom: 8,
  },
  subTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6,
  },
  status: {
    marginBottom: 8,
    color: "#333",
    fontWeight: "600",
  },
  card: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 12,
    marginVertical: 7,
    backgroundColor: "#fafafa",
  },
  album: {
    fontSize: 13,
    fontWeight: "700",
    color: "#555",
  },
  file: {
    fontSize: 15,
    fontWeight: "800",
    marginVertical: 4,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 5,
    flexWrap: "wrap",
  },
  details: {
    marginTop: 8,
  },
  label: {
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 9,
    padding: 9,
    marginVertical: 4,
    backgroundColor: "#fff",
  },
  captionInput: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  warning: {
    color: "#9a5b00",
    marginVertical: 10,
  },
  empty: {
    padding: 20,
    color: "#777",
    textAlign: "center",
  },
  logBox: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    padding: 8,
    backgroundColor: "#111",
    marginVertical: 10,
  },
  logHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  logTitle: {
    color: "#fff",
    fontWeight: "800",
  },
  logHint: {
    color: "#aaa",
  },
  logScroll: {
    maxHeight: 210,
    backgroundColor: "#000",
    borderRadius: 6,
    padding: 6,
  },
  logLine: {
    color: "#d6ffd6",
    fontSize: 11,
    marginBottom: 3,
  },
  linkLabel: {
  fontSize: 13,
  fontWeight: "700",
  color: "#333",
  marginTop: 8,
  marginBottom: 2,
  },

  linkInput: {
    borderWidth: 1,
    borderColor: "#888",
    borderRadius: 9,
    padding: 10,
    marginVertical: 4,
    backgroundColor: "#fff",
    color: "#111",
    minHeight: 44,
  },
  logWarn: {
    color: "#ffe08a",
  },
  logError: {
    color: "#ff9a9a",
  },
});
