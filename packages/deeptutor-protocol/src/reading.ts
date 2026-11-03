import type { DtClient } from './http';
import type { DtUploadFile } from './knowledge';

/*
 * DeepTutor's Reading (1.7.1, `/api/reading`): collections of materials (PDFs, e-books, Office
 * files, text, web pages, videos) read with a tutor beside you. Each material is cut once into
 * numbered units (pages, chapters, slides, sections or transcript segments), addressed by a
 * 1-based locator; highlights, bookmarks and your place all name a locator. A collection's chats
 * send the material and the locator in view with every message. Videos live here too (DeepTutor
 * retired its separate Watching page).
 */

const BASE = '/api/reading';
const segment = (value: string) => encodeURIComponent(value);
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

export type DtMaterialKind = 'file' | 'web' | 'video' | 'youtube' | 'bilibili' | 'audio';
export type DtMaterialStatus = 'queued' | 'processing' | 'ready' | 'failed';
/** How a material is shown: its text, a PDF, an e-book, or a video or audio player. */
export type DtRenderMode = 'text' | 'pdf' | 'epub' | 'video' | 'audio';

/** The colours a collection may have ("" is the plain one). */
export const DT_COLLECTION_COLORS = ['', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'violet', 'slate'] as const;
export const DT_HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;
export type DtHighlightColor = (typeof DT_HIGHLIGHT_COLORS)[number];
/** Links one import may take. */
export const DT_IMPORT_URLS_MAX = 50;

export interface DtMaterial {
  id: string;
  title: string;
  filename: string;
  kind: DtMaterialKind | string;
  sourceUrl: string;
  mime: string;
  renderMode: DtRenderMode | string;
  coverUrl: string;
  /** Seconds, for videos and audio. */
  duration: number | null;
  status: DtMaterialStatus | string;
  /** 0–100 while it's being prepared. */
  progress: number;
  errorCode: string;
  errorDetail: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  /** In the library list only. */
  collections: { id: string; title: string }[];
  sizeBytes: number;
  unitCount: number;
}

export interface DtCollection {
  id: string;
  title: string;
  description: string;
  color: string;
  /** The material open in the collection's reader (one for all its chats). */
  activeMaterialId: string | null;
  createdAt: number;
  updatedAt: number;
  /** In the collection's own order. */
  materials: DtMaterial[];
}

export interface DtReadingChat {
  id: string;
  title: string;
  activeMaterialId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Other chats of the collection this one reads too. */
  linked: string[];
}

export function materialOf(raw: unknown): DtMaterial {
  const material = record(raw);
  return {
    id: text(material.material_id),
    title: text(material.title) || text(material.filename),
    filename: text(material.filename),
    kind: text(material.source_kind) || 'file',
    sourceUrl: text(material.source_url),
    mime: text(material.mime),
    renderMode: text(material.render_mode) || 'text',
    coverUrl: text(material.cover_url),
    duration: typeof material.duration_seconds === 'number' ? material.duration_seconds : null,
    status: text(material.status) || 'ready',
    progress: Math.min(100, Math.max(0, number(material.progress))),
    errorCode: text(material.error_code),
    errorDetail: text(material.error_detail),
    createdAt: number(material.created_at),
    updatedAt: number(material.updated_at),
    lastOpenedAt: number(material.last_opened_at),
    collections: rows(material.collections)
      .map((item) => ({ id: text(item.workspace_id), title: text(item.title) }))
      .filter((item) => item.id),
    sizeBytes: number(material.size_bytes),
    unitCount: number(material.unit_count),
  };
}

export function collectionOf(raw: unknown): DtCollection {
  const collection = record(raw);
  const tabs = rows(collection.tabs).sort((a, b) => number(a.tab_order) - number(b.tab_order));
  return {
    id: text(collection.workspace_id),
    title: text(collection.title) || 'Untitled collection',
    description: text(collection.description),
    color: text(collection.color),
    activeMaterialId: text(collection.active_material_id) || null,
    createdAt: number(collection.created_at),
    updatedAt: number(collection.updated_at),
    materials: tabs.map((tab) => materialOf(tab.material)).filter((material) => material.id),
  };
}

function readingChatOf(raw: Record<string, unknown>): DtReadingChat {
  return {
    id: text(raw.session_id),
    title: text(raw.title),
    activeMaterialId: text(raw.active_material_id) || null,
    createdAt: number(raw.created_at),
    updatedAt: number(raw.updated_at),
    linked: strings(raw.linked_session_ids),
  };
}

/** Whether a material is still being prepared (a link or a video being fetched or transcribed). */
export function isPreparing(material: Pick<DtMaterial, 'status'>): boolean {
  return material.status === 'queued' || material.status === 'processing';
}

/** Whether a material plays (YouTube, Bilibili, an uploaded video or audio file) rather than reads. */
export function isMedia(material: Pick<DtMaterial, 'kind' | 'renderMode'>): boolean {
  return material.kind === 'youtube' || material.kind === 'bilibili' || material.renderMode === 'video' || material.renderMode === 'audio';
}

// ── Collections ──────────────────────────────────────────────────────────────

/** Your collections, the latest first (up to 100), and whether you may make new ones. */
export async function listCollections(client: DtClient): Promise<{ collections: DtCollection[]; canCreate: boolean }> {
  const body = record(await client.get<unknown>('/api/dashboard/learning-library/reading'));
  return { collections: rows(body.items).map(collectionOf).filter((item) => item.id), canCreate: body.can_create !== false };
}

/** A collection, with its chats' titles. */
export async function getCollection(client: DtClient, id: string): Promise<{ collection: DtCollection; chats: DtReadingChat[] }> {
  const body = record(await client.get<unknown>(`${BASE}/workspaces/${segment(id)}`));
  return { collection: collectionOf(body.workspace), chats: rows(body.sessions).map(readingChatOf).filter((chat) => chat.id) };
}

export async function createCollection(client: DtClient, input: { title: string; color?: string; materialIds?: string[] }): Promise<DtCollection> {
  const body = await client.post<unknown>(`${BASE}/workspaces`, {
    title: input.title.trim().slice(0, 300) || 'Untitled collection',
    color: input.color ?? '',
    ...(input.materialIds?.length ? { material_ids: input.materialIds.slice(0, 100) } : {}),
  });
  return collectionOf(record(body).workspace);
}

export async function updateCollection(client: DtClient, id: string, change: { title?: string; color?: string; description?: string }): Promise<DtCollection> {
  return collectionOf(record(await client.send<unknown>('PATCH', `${BASE}/workspaces/${segment(id)}`, { body: change }).then((response) => response.data)).workspace);
}

/** Deletes a collection **and its chats**; its materials stay in your library. */
export async function deleteCollection(client: DtClient, id: string): Promise<void> {
  await client.delete(`${BASE}/workspaces/${segment(id)}`);
}

export async function addToCollection(client: DtClient, id: string, materialId: string, makeActive = false): Promise<DtCollection> {
  return collectionOf(record(await client.post<unknown>(`${BASE}/workspaces/${segment(id)}/materials`, { material_id: materialId, make_active: makeActive })).workspace);
}

/** Opens a material in the collection's reader (for all its chats). */
export async function setActiveMaterial(client: DtClient, id: string, materialId: string): Promise<DtCollection> {
  return collectionOf(
    record((await client.send<unknown>('PUT', `${BASE}/workspaces/${segment(id)}/materials/${segment(materialId)}/active`)).data).workspace,
  );
}

/** Takes a material out of the collection (it stays in your library). */
export async function removeFromCollection(client: DtClient, id: string, materialId: string): Promise<DtCollection> {
  return collectionOf(record(await client.delete<unknown>(`${BASE}/workspaces/${segment(id)}/materials/${segment(materialId)}`)).workspace);
}

/** The collection's chats, the latest first, with their current titles. */
export async function listCollectionChats(client: DtClient, id: string): Promise<DtReadingChat[]> {
  return rows(record(await client.get<unknown>(`${BASE}/workspaces/${segment(id)}/sessions`)).sessions)
    .map(readingChatOf)
    .filter((chat) => chat.id);
}

// ── The library: adding materials ────────────────────────────────────────────

/** Every material you have, in collections or not (up to 200). */
export async function listLibrary(client: DtClient): Promise<DtMaterial[]> {
  return rows(record(await client.get<unknown>(`${BASE}/library/materials`)).materials)
    .map(materialOf)
    .filter((material) => material.id);
}

/** The file types DeepTutor reads, and the size limit. */
export async function getSupportedFormats(client: DtClient): Promise<{ extensions: string[]; maxBytes: number }> {
  const body = record(await client.get<unknown>(`${BASE}/supported-formats`));
  return { extensions: strings(body.extensions).map((extension) => extension.toLowerCase().replace(/^\./, '')), maxBytes: number(body.max_bytes) };
}

/**
 * Links to read: web pages, YouTube and Bilibili videos. DeepTutor fetches them in the
 * background (poll the collection), into `collectionId`, or a new collection titled `newTitle`.
 */
export async function importLinks(client: DtClient, urls: string[], target: { collectionId: string } | { newTitle?: string }): Promise<{ materials: DtMaterial[]; collection: DtCollection | null }> {
  const body = record(
    await client.post<unknown>(`${BASE}/library/import-urls`, {
      urls: urls.slice(0, DT_IMPORT_URLS_MAX),
      ...('collectionId' in target ? { workspace_id: target.collectionId } : target.newTitle ? { workspace_title: target.newTitle } : {}),
    }),
  );
  const collection = record(body.workspace);
  return { materials: rows(body.materials).map(materialOf), collection: Object.keys(collection).length ? collectionOf(collection) : null };
}

/** The web addresses in pasted text (http and https only). */
export function linksIn(pasted: string): string[] {
  return [...new Set(pasted.split(/\s+/).filter((word) => /^https?:\/\/\S+$/i.test(word)))];
}

/**
 * Uploads a file. Documents are read before DeepTutor answers (large ones take a while), so the
 * material comes back ready; audio and video come back at once and are transcribed after.
 * `reuse: false` keeps a separate copy when the same file is already in your library.
 */
export async function uploadMaterial(client: DtClient, file: DtUploadFile, name: string, reuse = true): Promise<DtMaterialDetail> {
  const form = new FormData();
  form.append('file', file as Blob, name);
  const response = await client.send<unknown>('POST', `${BASE}/materials`, { body: form, query: { reuse }, timeoutMs: 10 * 60_000 });
  return materialDetailOf(response.data);
}

/** Fetches or transcribes a material again (one that failed, or seems stuck). */
export async function retryMaterial(client: DtClient, id: string): Promise<DtMaterial> {
  return materialOf(record(await client.post<unknown>(`${BASE}/materials/${segment(id)}/retry`)).material);
}

/** Deletes a material from your library and every collection, with its highlights. */
export async function deleteMaterial(client: DtClient, id: string): Promise<void> {
  await client.delete(`${BASE}/materials/${segment(id)}`);
}

// ── Reading a material ───────────────────────────────────────────────────────

export interface DtOutlineEntry {
  locator: number;
  title: string;
  level: number;
}

export interface DtMaterialDetail {
  id: string;
  title: string;
  filename: string;
  /** What one locator is: page, chapter, slide, section or segment. */
  unit: string;
  unitCount: number;
  mime: string;
  renderMode: DtRenderMode | string;
  /** "web_markdown" units are Markdown; "plain_text" units are shown as written. */
  contentFormat: string;
  /** The original file can be shown (PDFs). */
  hasRawView: boolean;
  sourceType: string;
  sourceUrl: string;
  revision: number;
  annotationCount: number;
  outline: DtOutlineEntry[];
  /** Per locator: its title and where it is in the source (`#t=…` for media). */
  unitRefs: { locator: number; href: string; title: string }[];
}

export function materialDetailOf(raw: unknown): DtMaterialDetail {
  const detail = record(raw);
  return {
    id: text(detail.material_id),
    title: text(detail.title) || text(detail.filename),
    filename: text(detail.filename),
    unit: text(detail.unit) || 'section',
    unitCount: number(detail.unit_count),
    mime: text(detail.mime),
    renderMode: text(detail.render_mode) || 'text',
    contentFormat: text(detail.content_format) || 'plain_text',
    hasRawView: detail.has_raw_view === true,
    sourceType: text(detail.source_type),
    sourceUrl: text(detail.source_url),
    revision: Math.max(1, number(detail.revision)),
    annotationCount: number(detail.annotation_count),
    outline: rows(detail.outline)
      .map((entry) => ({ locator: number(entry.locator), title: text(entry.title), level: Math.max(1, number(entry.level)) }))
      .filter((entry) => entry.locator >= 1 && entry.title),
    unitRefs: rows(detail.unit_refs)
      .map((ref) => ({ locator: number(ref.locator), href: text(ref.source_href), title: text(ref.title) }))
      .filter((ref) => ref.locator >= 1),
  };
}

export async function getMaterial(client: DtClient, id: string): Promise<DtMaterialDetail> {
  return materialDetailOf(await client.get<unknown>(`${BASE}/materials/${segment(id)}`));
}

/** One unit's text. */
export async function getUnit(client: DtClient, id: string, locator: number): Promise<string> {
  return text(record(await client.get<unknown>(`${BASE}/materials/${segment(id)}/units/${locator}`)).text);
}

/** The address of the original file (PDFs; videos and audio you uploaded). */
export function rawMaterialUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${BASE}/materials/${segment(id)}/raw`;
}

/** The address of an image from the material (a PDF's figure, named by its marker). */
export function materialImageUrl(baseUrl: string, id: string, name: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${BASE}/materials/${segment(id)}/media/${segment(name)}`;
}

export interface DtTranscriptSegment {
  locator: number;
  text: string;
  title: string;
  /** Where it starts, in seconds. */
  start: number;
}

/** A video's or audio's transcript, one segment per locator. Empty when there's none. */
export async function getTranscript(client: DtClient, id: string): Promise<{ segments: DtTranscriptSegment[]; truncated: boolean }> {
  const body = record(await client.get<unknown>(`${BASE}/materials/${segment(id)}/transcript`));
  return {
    segments: rows(body.segments)
      .map((item) => ({ locator: number(item.locator), text: text(item.text), title: text(item.title), start: timeOf(text(item.source_href)) ?? 0 }))
      .filter((item) => item.locator >= 1 && item.text && item.text !== NO_TRANSCRIPT),
    truncated: body.truncated === true,
  };
}

/** What DeepTutor writes when a video has no transcript. */
const NO_TRANSCRIPT = '[Transcript unavailable for this video.]';

/** Seconds from a `#t=…` anchor, or null. */
export function timeOf(anchor: string): number | null {
  const match = /#t=(\d+(?:\.\d+)?)/.exec(anchor);
  return match ? Number(match[1]) : null;
}

/** `M:SS`, or `H:MM:SS` past an hour. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** A YouTube or Bilibili link that starts at a time. */
export function videoLinkAt(sourceUrl: string, seconds: number): string {
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set('t', String(Math.floor(seconds)));
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

// ── Your place, bookmarks and highlights ─────────────────────────────────────

export interface DtReadingPosition {
  locator: number;
  /** Where exactly (an e-book's CFI, a video's `#t=`); "" for a page or section. */
  anchor: string;
  /** 0–1. */
  percentage: number;
}

export async function getPosition(client: DtClient, id: string): Promise<DtReadingPosition | null> {
  try {
    const body = record(await client.get<unknown>(`${BASE}/materials/${segment(id)}/position`));
    const locator = number(body.locator);
    return locator >= 1 ? { locator, anchor: text(body.source_anchor), percentage: number(body.percentage) } : null;
  } catch {
    return null;
  }
}

/** Records where you are (it also counts towards your reading progress). */
export async function savePosition(client: DtClient, id: string, position: DtReadingPosition): Promise<void> {
  await client.send('PUT', `${BASE}/materials/${segment(id)}/position`, {
    body: { locator: Math.max(1, Math.round(position.locator)), source_anchor: position.anchor.slice(0, 4096), percentage: Math.min(1, Math.max(0, position.percentage)) },
  });
}

export interface DtBookmark {
  id: string;
  locator: number;
  label: string;
}

export async function listBookmarks(client: DtClient, id: string): Promise<DtBookmark[]> {
  return rows(record(await client.get<unknown>(`${BASE}/materials/${segment(id)}/bookmarks`)).bookmarks)
    .map((item) => ({ id: text(item.bookmark_id), locator: number(item.locator), label: text(item.label) }))
    .filter((item) => item.id && item.locator >= 1)
    .sort((a, b) => a.locator - b.locator);
}

/** One bookmark per locator: adding it again answers with the one already there. */
export async function addBookmark(client: DtClient, id: string, locator: number, label: string): Promise<DtBookmark> {
  const body = record(await client.post<unknown>(`${BASE}/materials/${segment(id)}/bookmarks`, { locator, label: label.slice(0, 200) }));
  return { id: text(body.bookmark_id), locator: number(body.locator), label: text(body.label) };
}

export async function removeBookmark(client: DtClient, id: string, bookmarkId: string): Promise<void> {
  await client.delete(`${BASE}/materials/${segment(id)}/bookmarks/${segment(bookmarkId)}`);
}

export interface DtTextSelector {
  type: 'TextQuoteSelector' | 'TextPositionSelector';
  exact?: string;
  prefix?: string;
  suffix?: string;
  start?: number;
  end?: number;
}

export interface DtAnnotation {
  id: string;
  locator: number;
  kind: 'highlight' | 'underline' | 'note' | 'citation' | string;
  color: string;
  quote: string;
  note: string;
  /** "assistant" for the tutor's marks. */
  author: string;
  /** An e-book's CFI, or a video's `#t=…`. */
  anchor: string;
  /** Where it sits on a PDF page (0–1 boxes); the app doesn't draw these. */
  rects: number[][];
  selectors: DtTextSelector[];
  createdAt: number;
  updatedAt: number;
}

function annotationOf(raw: unknown): DtAnnotation {
  const item = record(raw);
  return {
    id: text(item.annotation_id),
    locator: number(item.locator),
    kind: text(item.kind) || 'highlight',
    color: text(item.color) || 'yellow',
    quote: text(item.quote),
    note: text(item.note),
    author: text(item.author) || 'user',
    anchor: text(item.source_anchor),
    rects: Array.isArray(item.rects) ? (item.rects as unknown[]).filter((rect): rect is number[] => Array.isArray(rect)) : [],
    selectors: rows(item.selectors).map((selector) => selector as unknown as DtTextSelector),
    createdAt: number(item.created_at),
    updatedAt: number(item.updated_at),
  };
}

export async function listAnnotations(client: DtClient, id: string): Promise<DtAnnotation[]> {
  return rows(await client.get<unknown>(`${BASE}/materials/${segment(id)}/annotations`))
    .map(annotationOf)
    .filter((item) => item.id);
}

/**
 * Saves a highlight or note: new without `id`, else replacing that one (DeepTutor then counts it
 * as yours). With selectors, DeepTutor checks them against the unit's text and keeps its own
 * copy of the quote.
 */
export async function saveAnnotation(
  client: DtClient,
  materialId: string,
  annotation: { id?: string; locator: number; kind?: string; color?: string; quote: string; note?: string; anchor?: string; rects?: number[][]; selectors?: DtTextSelector[] },
): Promise<DtAnnotation> {
  const body = await client.send<unknown>('PUT', `${BASE}/materials/${segment(materialId)}/annotations`, {
    body: {
      annotation_id: annotation.id ?? '',
      locator: annotation.locator,
      kind: annotation.kind ?? 'highlight',
      color: annotation.color ?? 'yellow',
      quote: annotation.quote.slice(0, 2000),
      note: annotation.note ?? '',
      rects: annotation.rects ?? [],
      source_anchor: annotation.anchor ?? '',
      selectors: annotation.selectors ?? [],
    },
  });
  return annotationOf(body.data);
}

export async function deleteAnnotation(client: DtClient, materialId: string, annotationId: string): Promise<void> {
  await client.delete(`${BASE}/materials/${segment(materialId)}/annotations/${segment(annotationId)}`);
}

// ── A unit's text, as the reader shows it ────────────────────────────────────

/** A paragraph of a unit, and where it is in the unit's text. */
export interface DtTextBlock {
  start: number;
  end: number;
  text: string;
}

/**
 * A unit's text cut into paragraphs at blank lines. Markdown code fences and `$$` maths keep
 * their blank lines. Offsets are into the unit's text, so a paragraph names exactly the text
 * DeepTutor keeps.
 */
export function textBlocks(unit: string): DtTextBlock[] {
  const blocks: DtTextBlock[] = [];
  let start = -1;
  let end = 0;
  let fence: string | null = null;
  let maths = false;
  let offset = 0;
  const close = () => {
    if (start >= 0) blocks.push({ start, end, text: unit.slice(start, end) });
    start = -1;
  };
  for (const line of unit.split('\n')) {
    const lineEnd = offset + line.length;
    const trimmed = line.trim();
    const fenceMark = /^(```+|~~~+)/.exec(trimmed)?.[1];
    if (!trimmed && !fence && !maths) {
      close();
    } else {
      if (start < 0) start = offset + (line.length - line.trimStart().length);
      end = offset + line.trimEnd().length;
      if (fenceMark) fence = fence === null ? fenceMark.slice(0, 3) : trimmed.startsWith(fence) ? null : fence;
      else if (!fence && trimmed === '$$') maths = !maths;
      else if (!fence && /^\$\$/.test(trimmed) !== /\$\$$/.test(trimmed)) maths = !maths;
    }
    offset = lineEnd + 1;
  }
  close();
  return blocks;
}

/** The selectors DeepTutor checks a passage by: the text with some context, and where it is. */
export function passageSelectors(unit: string, start: number, end: number): DtTextSelector[] {
  return [
    { type: 'TextQuoteSelector', exact: unit.slice(start, end), prefix: unit.slice(Math.max(0, start - 128), start), suffix: unit.slice(end, end + 128) },
    { type: 'TextPositionSelector', start, end },
  ];
}

/** Where each of a unit's highlights is in its text: by position when it still matches, else by its quote. */
export function highlightRanges(unit: string, annotations: DtAnnotation[]): { annotation: DtAnnotation; start: number; end: number }[] {
  const found: { annotation: DtAnnotation; start: number; end: number }[] = [];
  for (const annotation of annotations) {
    const position = annotation.selectors.find((selector) => selector.type === 'TextPositionSelector');
    if (position && typeof position.start === 'number' && typeof position.end === 'number' && unit.slice(position.start, position.end) === annotation.quote) {
      found.push({ annotation, start: position.start, end: position.end });
      continue;
    }
    const quote = annotation.quote.trim();
    if (!quote) continue;
    const at = unit.indexOf(quote);
    if (at >= 0) found.push({ annotation, start: at, end: at + quote.length });
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * A Markdown paragraph as it reads on screen (marks, links and list signs dropped), to save as a
 * highlight's quote: DeepTutor's reader finds such a highlight again by its words.
 */
export function markdownQuote(block: string): string {
  return block
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|\*|_|`)(?=\S)([^]*?\S)\1/g, '$2')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** A unit's text with DeepTutor's `[图片 N: name]` image markers picked out. */
export function imageMarkers(unit: string): ({ type: 'text'; text: string } | { type: 'image'; name: string })[] {
  const parts: ({ type: 'text'; text: string } | { type: 'image'; name: string })[] = [];
  const pattern = /\[图片 \d+: ([^\]\s]+)\]/g;
  let last = 0;
  for (let match = pattern.exec(unit); match; match = pattern.exec(unit)) {
    if (match.index > last) parts.push({ type: 'text', text: unit.slice(last, match.index) });
    parts.push({ type: 'image', name: match[1] as string });
    last = match.index + match[0].length;
  }
  if (last < unit.length) parts.push({ type: 'text', text: unit.slice(last) });
  return parts;
}

/** The pages (locators) a reply cites, `[p.3]`, `[p.3, 5]`, `[p.3–5]`, in order and once each (ranges capped at 40). */
export function citedLocators(reply: string): number[] {
  const found: number[] = [];
  const add = (value: number) => {
    if (value >= 1 && !found.includes(value)) found.push(value);
  };
  for (const match of reply.replace(/```[\s\S]*?```/g, '').matchAll(/\[p\.\s*(\d[\d\s,–—-]*)\]/gi)) {
    for (const part of (match[1] as string).split(',')) {
      const [from, to] = part.split(/[–—-]/).map((value) => Number(value.trim()));
      if (!from) continue;
      if (to && to > from) for (let page = from; page <= Math.min(to, from + 40); page += 1) add(page);
      else add(from);
    }
  }
  return found;
}

// ── The tutor beside the text ────────────────────────────────────────────────

/** Where you are in the material, sent with each message. */
export interface DtReadingViewport {
  locator?: number;
  /** The passage you're asking about (up to 2,000 characters). */
  selection?: string;
  /** A video's playing position. */
  timeSeconds?: number;
}

/**
 * What every message of a reading chat carries: the collection, the material and its revision,
 * and where you are in it. DeepTutor doesn't remember these between messages, so send them each
 * time; without a material it reads the collection's open one.
 */
export function readingTurnFields(input: { collectionId: string; materialId?: string | null; revision?: number | null; viewport?: DtReadingViewport; linkedChats?: string[] }) {
  const viewport: Record<string, unknown> = {};
  if (input.viewport?.locator && input.viewport.locator >= 1) viewport.locator = Math.round(input.viewport.locator);
  if (input.viewport?.selection?.trim()) viewport.selection = input.viewport.selection.trim().slice(0, 2000);
  if (typeof input.viewport?.timeSeconds === 'number' && input.viewport.timeSeconds >= 0) viewport.time_seconds = input.viewport.timeSeconds;
  return {
    capability: 'chat',
    workspaceMode: 'immersive_reading',
    readingWorkspaceId: input.collectionId,
    ...(input.materialId ? { readingMaterialId: input.materialId } : {}),
    ...(input.materialId && input.revision ? { readingMaterialRevision: input.revision } : {}),
    ...(Object.keys(viewport).length ? { readingViewport: viewport } : {}),
    ...(input.linkedChats?.length ? { historyReferences: input.linkedChats } : {}),
  };
}

/** The collection (and material) a chat reads, from its saved preferences; null for any other chat. */
export function readingOfPreferences(preferences: Record<string, unknown> | null | undefined): { collectionId: string; materialId: string } | null {
  if (!preferences || preferences.workspace_mode !== 'immersive_reading') return null;
  const collectionId = text(preferences.reading_workspace_id).trim();
  return collectionId ? { collectionId, materialId: text(preferences.reading_material_id).trim() } : null;
}

/** Our words for the tutor's passage actions, sent as the message (as DeepTutor's reader sends them). */
export const PASSAGE_PROMPTS = {
  explain: 'Explain this passage.',
  translate: (language: string) => `Translate this passage into ${language}.`,
  guide: 'Guide me through this passage step by step, without giving the answer away.',
} as const;
