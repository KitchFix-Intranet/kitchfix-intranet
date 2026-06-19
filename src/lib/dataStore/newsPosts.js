/**
 * newsPosts.js - CRUD for the news_posts sheet tab (HUB spreadsheet).
 *
 * Schema (cols A-M):
 *   A: postId         B: title          C: body          D: tag
 *   E: pinned         F: author         G: publishDate   H: expiresDate
 *   I: countdownLabel J: countdownDate  K: link          L: active
 *   M: imageUrl (Drive-hosted image, optional)
 *
 * The dashboard read path inlines its own mapper at
 * src/app/api/dashboard/route.js:27-43 (active + non-expired only).
 * This file adds write helpers + an admin-side read that returns
 * everything (including inactive and expired posts).
 */

import { SHEET_IDS, readSheetSA, appendRowSA, updateRangeSA, clearRangeSA } from "@/lib/sheets";

const TAB = "news_posts";

function mintPostId() {
  return `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a news post. Returns the generated postId.
 */
export async function createNewsPost(post) {
  const postId = mintPostId();
  const row = [
    postId,
    post.title || "",
    post.body || "",
    post.tag || "general",
    post.pinned ? "TRUE" : "FALSE",
    post.author || "",
    post.publishDate || new Date().toISOString().split("T")[0],
    post.expiresDate || "",
    post.countdownLabel || "",
    post.countdownDate || "",
    post.link || "",
    post.active === false ? "FALSE" : "TRUE",
    post.imageUrl || "",
  ];
  await appendRowSA(SHEET_IDS.HUB, TAB, row);
  return postId;
}

/**
 * Update an existing post by postId. Only provided fields change;
 * everything else is read-then-rewritten so the row shape stays intact.
 */
export async function updateNewsPost(postId, patch) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, TAB);
  const rowIndex = rows.findIndex((r) => String(r[0] || "").trim() === postId);
  if (rowIndex === -1) throw new Error(`Post not found: ${postId}`);

  const sheetRow = rowIndex + 2; // +1 header, +1 1-indexed
  const current = rows[rowIndex];

  const updated = [
    postId,
    patch.title !== undefined ? patch.title : (current[1] || ""),
    patch.body !== undefined ? patch.body : (current[2] || ""),
    patch.tag !== undefined ? patch.tag : (current[3] || "general"),
    patch.pinned !== undefined ? (patch.pinned ? "TRUE" : "FALSE") : (current[4] || "FALSE"),
    patch.author !== undefined ? patch.author : (current[5] || ""),
    patch.publishDate !== undefined ? patch.publishDate : (current[6] || ""),
    patch.expiresDate !== undefined ? patch.expiresDate : (current[7] || ""),
    patch.countdownLabel !== undefined ? patch.countdownLabel : (current[8] || ""),
    patch.countdownDate !== undefined ? patch.countdownDate : (current[9] || ""),
    patch.link !== undefined ? patch.link : (current[10] || ""),
    patch.active !== undefined ? (patch.active ? "TRUE" : "FALSE") : (current[11] || "TRUE"),
    patch.imageUrl !== undefined ? patch.imageUrl : (current[12] || ""),
  ];

  await updateRangeSA(SHEET_IDS.HUB, `${TAB}!A${sheetRow}:M${sheetRow}`, [updated]);
  return postId;
}

/**
 * Unpin all posts except optionally the one being pinned. Pass null
 * to unpin everything (useful right before creating a new pinned post).
 */
export async function enforceSinglePin(keepPostId) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, TAB);
  const writes = [];
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0] || "").trim();
    const isPinned = String(rows[i][4] || "").toUpperCase() === "TRUE";
    if (isPinned && id !== keepPostId) {
      const sheetRow = i + 2;
      writes.push(updateRangeSA(SHEET_IDS.HUB, `${TAB}!E${sheetRow}`, [["FALSE"]]));
    }
  }
  await Promise.all(writes);
}

/**
 * Delete a post by clearing its row. The active=TRUE filter in the
 * dashboard read path naturally hides cleared rows (col L will be empty).
 * readAllNewsPosts() also skips rows with a blank postId.
 */
export async function deleteNewsPost(postId) {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, TAB);
  const rowIndex = rows.findIndex((r) => String(r[0] || "").trim() === postId);
  if (rowIndex === -1) throw new Error(`Post not found: ${postId}`);
  const sheetRow = rowIndex + 2;
  await clearRangeSA(SHEET_IDS.HUB, `${TAB}!A${sheetRow}:M${sheetRow}`);
}

/**
 * Read ALL posts (active + inactive + expired) for the admin list.
 * Dashboard bootstrap returns only active+non-expired; admin needs the full set.
 */
export async function readAllNewsPosts() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, TAB);
  return rows
    .filter((r) => r[0]) // skip blank rows left behind by deletes
    .map((r) => ({
      postId: String(r[0] || "").trim(),
      title: String(r[1] || ""),
      body: String(r[2] || ""),
      tag: String(r[3] || "general").toLowerCase(),
      pinned: String(r[4] || "").toUpperCase() === "TRUE",
      author: String(r[5] || ""),
      publishDate: String(r[6] || ""),
      expiresDate: String(r[7] || ""),
      countdownLabel: String(r[8] || ""),
      countdownDate: String(r[9] || ""),
      link: String(r[10] || ""),
      active: String(r[11] || "").toUpperCase() === "TRUE",
      imageUrl: String(r[12] || ""),
    }))
    .sort((a, b) => (b.publishDate || "").localeCompare(a.publishDate || ""));
}
