import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, FlatList, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as MediaLibrary from "expo-media-library";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Base64 } from "js-base64";

type PlatformLinks = { tiktok?: string; instagram?: string; youtube?: string; x?: string };
type Settings = { sourceAlbumsCsv: string; doneAlbumName: string; githubOwner: string; githubRepo: string; githubBranch: string; githubToken: string; githubLogPath: string; dayTitle: string };
type ClipStatus = { assetId: string; albumTitle: string; albumId?: string; filename: string; caption: string; links: PlatformLinks; done: boolean };
type QueueItem = { asset: MediaLibrary.Asset; albumTitle: string; albumId?: string; status: ClipStatus };

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

function splitAlbums(csv: string) { return csv.split(",").map(x => x.trim()).filter(Boolean); }
function inferLang(album: string, filename: string) {
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
function titleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/^D\d+_\d+_[A-Z]{2}_?/i, "").replace(/^montage_\d+_\d+_/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function makeCaption(album: string, filename: string) {
  const lang = inferLang(album, filename);
  const title = titleFromFilename(filename);
  return `${title}\n\n#DigitalFreedom #PavelDurov #Telegram #Privacy #FreedomClipsAI #${lang}Shorts`;
}
async function loadSettings(): Promise<Settings> { const raw = await AsyncStorage.getItem(SETTINGS_KEY); return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS; }
async function saveSettings(s: Settings) { await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
async function loadStatuses(): Promise<Record<string, ClipStatus>> { const raw = await AsyncStorage.getItem(STATUSES_KEY); return raw ? JSON.parse(raw) : {}; }
async function saveStatuses(s: Record<string, ClipStatus>) { await AsyncStorage.setItem(STATUSES_KEY, JSON.stringify(s)); }
function isPublished(s: ClipStatus) { return Boolean(s.links.tiktok || s.links.instagram || s.links.youtube || s.links.x); }
function allFourLinks(s: ClipStatus) { return Boolean(s.links.tiktok && s.links.instagram && s.links.youtube && s.links.x); }
function githubPathForUrl(path: string) { return path.split("/").map(encodeURIComponent).join("/"); }

function buildMarkdown(statuses: ClipStatus[], settings: Settings) {
  const rows = statuses.filter(x => x.done || isPublished(x)).sort((a,b) => a.filename.localeCompare(b.filename)).map((x, i) => {
    const lang = inferLang(x.albumTitle, x.filename);
    return `| ${i + 1} | ${x.filename} | ${lang} | ${x.links.tiktok || ""} | ${x.links.instagram || ""} | ${x.links.youtube || ""} | ${x.links.x || ""} | ${x.done ? "✅" : "⏳"} |`;
  });
  const published = statuses.filter(x => x.done || isPublished(x));
  const languages = Array.from(new Set(published.map(x => inferLang(x.albumTitle, x.filename)))).join(", ");
  return `# ${settings.dayTitle}\n\nDate: ${new Date().toISOString().slice(0, 10)}\n\n## Published clips\n\n| # | File | Lang | TikTok | Instagram | YouTube Shorts | X | Status |\n|---|------|------|--------|-----------|----------------|---|--------|\n${rows.join("\n")}\n\n## Summary\n\nPublished records: ${published.length}  \nLanguages: ${languages || ""}\n\n## Notes\n\n- Best hook:\n- Best platform response:\n- Problems:\n- Tomorrow:\n`;
}
async function getGithubFileSha(settings: Settings) {
  const path = githubPathForUrl(settings.githubLogPath);
  const url = `https://api.github.com/repos/${settings.githubOwner}/${settings.githubRepo}/contents/${path}?ref=${encodeURIComponent(settings.githubBranch)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${settings.githubToken}`, Accept: "application/vnd.github+json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.sha || null;
}
async function updateGithubMarkdown(settings: Settings, markdown: string) {
  if (!settings.githubToken.trim()) throw new Error("GitHub token is empty. Open Settings and paste fine-grained PAT.");
  const sha = await getGithubFileSha(settings);
  const path = githubPathForUrl(settings.githubLogPath);
  const url = `https://api.github.com/repos/${settings.githubOwner}/${settings.githubRepo}/contents/${path}`;
  const body: any = { message: `Update ${settings.githubLogPath}`, content: Base64.encode(markdown), branch: settings.githubBranch };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${settings.githubToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
}
async function ensureAlbum(title: string, initialAsset?: MediaLibrary.Asset): Promise<MediaLibrary.Album | null> {
  const albums = await MediaLibrary.getAlbumsAsync();
  const existing = albums.find((a: any) => a.title === title);
  if (existing) return existing;
  if (!initialAsset) return null;
  try { return await MediaLibrary.createAlbumAsync(title, initialAsset, false); } catch (e) { console.warn("createAlbumAsync failed", e); return null; }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [statuses, setStatuses] = useState<Record<string, ClipStatus>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Ready");

  async function persistStatuses(next: Record<string, ClipStatus>) { setStatuses(next); await saveStatuses(next); }
  async function init() {
    const savedSettings = await loadSettings();
    const savedStatuses = await loadStatuses();
    setSettings(savedSettings); setStatuses(savedStatuses);
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Media library permission is required."); return; }
    await refreshQueue(savedSettings, savedStatuses);
  }
  async function refreshQueue(currentSettings = settings, currentStatuses = statuses) {
    setStatusText("Scanning albums...");
    const sourceAlbumTitles = splitAlbums(currentSettings.sourceAlbumsCsv);
    const albums = await MediaLibrary.getAlbumsAsync();
    const nextStatuses = { ...currentStatuses };
    const nextQueue: QueueItem[] = [];
    for (const albumTitle of sourceAlbumTitles) {
      const album: any = albums.find((a: any) => a.title === albumTitle);
      if (!album) { console.warn(`Album not found: ${albumTitle}`); continue; }
      const page = await MediaLibrary.getAssetsAsync({ album, mediaType: "video", first: 50, sortBy: [MediaLibrary.SortBy.creationTime] });
      const firstUnfinished = page.assets.find(asset => !nextStatuses[asset.id]?.done);
      if (!firstUnfinished) continue;
      const existing = nextStatuses[firstUnfinished.id];
      const status: ClipStatus = existing || { assetId: firstUnfinished.id, albumTitle, albumId: album.id, filename: firstUnfinished.filename, caption: makeCaption(albumTitle, firstUnfinished.filename), links: {}, done: false };
      status.albumTitle = albumTitle; status.albumId = album.id; status.filename = firstUnfinished.filename;
      nextStatuses[firstUnfinished.id] = status;
      nextQueue.push({ asset: firstUnfinished, albumTitle, albumId: album.id, status });
    }
    setQueue(nextQueue); await persistStatuses(nextStatuses); setStatusText(`Queue: ${nextQueue.length} video(s)`);
  }
  useEffect(() => { init(); }, []);
  const publishedStatuses = useMemo(() => Object.values(statuses).filter(x => x.done || isPublished(x)), [statuses]);

  async function copyCaption(status: ClipStatus) { await Clipboard.setStringAsync(status.caption); setStatusText(`Caption copied: ${status.filename}`); }
  async function shareVideo(asset: MediaLibrary.Asset, status: ClipStatus) {
    await Clipboard.setStringAsync(status.caption);
    const info = await MediaLibrary.getAssetInfoAsync(asset);
    const uri = info.localUri || info.uri || asset.uri;
    if (!uri) { Alert.alert("Error", "Cannot get local video URI."); return; }
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) { Alert.alert("Error", "Sharing is not available on this device."); return; }
    setStatusText("Caption copied. Opening Android share sheet...");
    await Sharing.shareAsync(uri, { mimeType: "video/mp4", dialogTitle: "Publish this clip", UTI: "public.movie" });
  }
  async function updateCaption(assetId: string, caption: string) { await persistStatuses({ ...statuses, [assetId]: { ...statuses[assetId], caption } }); }
  async function updateLink(assetId: string, platform: keyof PlatformLinks, value: string) {
    await persistStatuses({ ...statuses, [assetId]: { ...statuses[assetId], links: { ...statuses[assetId].links, [platform]: value } } });
  }
  async function markDoneAndMove(item: QueueItem) {
    const current = statuses[item.asset.id]; if (!current) return;
    if (!allFourLinks(current)) {
      Alert.alert("Links missing", "Not all four links are filled. Mark done anyway?", [
        { text: "Cancel", style: "cancel" }, { text: "Mark Done", onPress: () => actuallyMarkDoneAndMove(item) }
      ]);
      return;
    }
    await actuallyMarkDoneAndMove(item);
  }
  async function actuallyMarkDoneAndMove(item: QueueItem) {
    try {
      setStatusText("Moving to Done album...");
      const doneAlbum: any = await ensureAlbum(settings.doneAlbumName, item.asset);
      if (doneAlbum) {
        try { await MediaLibrary.addAssetsToAlbumAsync([item.asset], doneAlbum, false); } catch (e) { console.warn("addAssetsToAlbumAsync failed", e); }
        if (item.albumId) { try { await MediaLibrary.removeAssetsFromAlbumAsync([item.asset], item.albumId); } catch (e) { console.warn("removeAssetsFromAlbumAsync failed", e); } }
      }
      const next = { ...statuses, [item.asset.id]: { ...statuses[item.asset.id], done: true } };
      await persistStatuses(next); await refreshQueue(settings, next); setStatusText(`Done: ${item.status.filename}`);
    } catch (e: any) { Alert.alert("Move failed", e.message || String(e)); }
  }
  async function syncGithub() {
    try {
      setStatusText("Generating GitHub markdown...");
      const markdown = buildMarkdown(Object.values(statuses), settings);
      await updateGithubMarkdown(settings, markdown);
      setStatusText(`GitHub synced: ${settings.githubLogPath}`);
      Alert.alert("GitHub synced", `Updated ${settings.githubLogPath}`);
    } catch (e: any) { Alert.alert("GitHub error", e.message || String(e)); setStatusText("GitHub sync failed"); }
  }
  async function copyMarkdownPreview() { await Clipboard.setStringAsync(buildMarkdown(Object.values(statuses), settings)); Alert.alert("Copied", "Markdown log copied to clipboard."); }
  async function saveSettingsFromState() { await saveSettings(settings); Alert.alert("Saved", "Settings saved."); await refreshQueue(settings, statuses); }

  function renderQueueItem({ item }: { item: QueueItem }) {
    const status = statuses[item.asset.id] || item.status;
    const selected = selectedAssetId === item.asset.id;
    const lang = inferLang(item.albumTitle, status.filename);
    return <View style={styles.card}>
      <Text style={styles.album}>{item.albumTitle} / {lang}</Text>
      <Text style={styles.file}>{status.filename}</Text>
      <Text>Status: {status.done ? "✅ Done" : isPublished(status) ? "⏳ Links added" : "Not published"}</Text>
      <View style={styles.row}><Button title="Copy caption" onPress={() => copyCaption(status)} /><Button title="Share video" onPress={() => shareVideo(item.asset, status)} /></View>
      <Button title={selected ? "Hide details" : "Edit links / caption"} onPress={() => setSelectedAssetId(selected ? null : item.asset.id)} />
      {selected && <View style={styles.details}>
        <Text style={styles.label}>Caption</Text>
        <TextInput style={[styles.input, styles.captionInput]} multiline value={status.caption} onChangeText={v => updateCaption(item.asset.id, v)} />
        <Text style={styles.label}>Published links</Text>
        <TextInput style={styles.input} placeholder="TikTok URL" value={status.links.tiktok || ""} onChangeText={v => updateLink(item.asset.id, "tiktok", v)} autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Instagram URL" value={status.links.instagram || ""} onChangeText={v => updateLink(item.asset.id, "instagram", v)} autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="YouTube Shorts URL" value={status.links.youtube || ""} onChangeText={v => updateLink(item.asset.id, "youtube", v)} autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="X / Twitter URL" value={status.links.x || ""} onChangeText={v => updateLink(item.asset.id, "x", v)} autoCapitalize="none" />
        <Button title="Mark done + move to Done album" onPress={() => markDoneAndMove(item)} />
      </View>}
    </View>;
  }

  if (showSettings) return <SafeAreaView style={styles.container}><ScrollView><Text style={styles.title}>Settings</Text>
    <Text style={styles.label}>Source albums, comma-separated</Text><TextInput style={styles.input} value={settings.sourceAlbumsCsv} onChangeText={v => setSettings({ ...settings, sourceAlbumsCsv: v })} />
    <Text style={styles.label}>Done album</Text><TextInput style={styles.input} value={settings.doneAlbumName} onChangeText={v => setSettings({ ...settings, doneAlbumName: v })} />
    <Text style={styles.label}>GitHub owner</Text><TextInput style={styles.input} value={settings.githubOwner} onChangeText={v => setSettings({ ...settings, githubOwner: v })} autoCapitalize="none" />
    <Text style={styles.label}>GitHub repo</Text><TextInput style={styles.input} value={settings.githubRepo} onChangeText={v => setSettings({ ...settings, githubRepo: v })} autoCapitalize="none" />
    <Text style={styles.label}>GitHub branch</Text><TextInput style={styles.input} value={settings.githubBranch} onChangeText={v => setSettings({ ...settings, githubBranch: v })} autoCapitalize="none" />
    <Text style={styles.label}>GitHub log path</Text><TextInput style={styles.input} value={settings.githubLogPath} onChangeText={v => setSettings({ ...settings, githubLogPath: v })} autoCapitalize="none" />
    <Text style={styles.label}>Day title</Text><TextInput style={styles.input} value={settings.dayTitle} onChangeText={v => setSettings({ ...settings, dayTitle: v })} />
    <Text style={styles.label}>GitHub fine-grained PAT token</Text><TextInput style={styles.input} value={settings.githubToken} onChangeText={v => setSettings({ ...settings, githubToken: v })} autoCapitalize="none" secureTextEntry placeholder="github_pat_..." />
    <Text style={styles.warning}>Token is stored locally with AsyncStorage. Good enough for a private personal APK MVP. Do not share an APK with your token configured.</Text>
    <Button title="Save settings" onPress={saveSettingsFromState} /><Button title="Back to queue" onPress={() => setShowSettings(false)} />
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={styles.container}>
    <Text style={styles.title}>Freedom Publisher</Text><Text style={styles.status}>{statusText}</Text>
    <View style={styles.row}><Button title="Refresh queue" onPress={() => refreshQueue()} /><Button title="Settings" onPress={() => setShowSettings(true)} /></View>
    <View style={styles.row}><Button title="Copy MD log" onPress={copyMarkdownPreview} /><Button title="Sync GitHub" onPress={syncGithub} /></View>
    <Text style={styles.subTitle}>Today queue: one video from each source album</Text>
    <FlatList data={queue} keyExtractor={x => x.asset.id} renderItem={renderQueueItem} ListEmptyComponent={<Text style={styles.empty}>No videos found. Create albums from Settings and put videos there.</Text>} />
    <Text style={styles.subTitle}>Tracked records: {publishedStatuses.length}</Text>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 14, paddingTop: 36, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "800", marginBottom: 8 },
  subTitle: { fontSize: 16, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  status: { marginBottom: 8, color: "#333" },
  card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 12, marginVertical: 7, backgroundColor: "#fafafa" },
  album: { fontSize: 13, fontWeight: "700", color: "#555" },
  file: { fontSize: 15, fontWeight: "800", marginVertical: 4 },
  row: { flexDirection: "row", gap: 8, marginVertical: 5, flexWrap: "wrap" },
  details: { marginTop: 8 }, label: { fontWeight: "700", marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#aaa", borderRadius: 9, padding: 9, marginVertical: 4, backgroundColor: "#fff" },
  captionInput: { minHeight: 110, textAlignVertical: "top" }, warning: { color: "#9a5b00", marginVertical: 10 },
  empty: { padding: 20, color: "#777", textAlign: "center" },
});
