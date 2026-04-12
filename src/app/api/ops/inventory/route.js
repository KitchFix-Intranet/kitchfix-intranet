/**
 * /api/ops/inventory/route.js — Inventory Manager API Sub-Route
 * Dev-gated: only INV_MANAGER_DEV_USERS can access.
 */

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/analytics";
import {
  handleInventoryBootstrap,
  handleCatalogGet,
  handleHistoryGet,
  handleReviewQueueGet,
  handlePrint,
  handleStartSession,
  handleCountSave,
  handleCountSubmit,
  handleAddItem,
  handleUpdateItem,
  handleBatchMoveItems,
  handleMergeItems,
  handleResolveQueue,
  handleSaveLocations,
  handleSaveSortOrder,
  handleAdminCorrect,
  handleScan,
  handleDedupCatalog,
  handleAISimilarityCheck,
  handleKeepSeparate,
  handleReviewAccept,
  handleReviewDelete,
handleAddSubZone,
  handleDeactivateLocation,
handleExcludeItem,
  handleUpdateLocation,
  handleUpdateCatalogItem,
  handleArchiveItem,
  handleReactivateItem,
  handleVerifyPrice,
} from "@/lib/inventoryActions";

const INV_MANAGER_DEV_USERS = ["k.fietek@kitchfix.com", "joe@kitchfix.com"];
function isAuthorized(email) { return INV_MANAGER_DEV_USERS.includes(email); }

export async function GET(request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  if (!isAuthorized(session.user.email)) return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const account = searchParams.get("account") || "";
  const fresh = searchParams.get("fresh") === "true";

  try {
    switch (action) {
      case "bootstrap": return NextResponse.json(await handleInventoryBootstrap({ account, fresh }));
      case "catalog": return NextResponse.json(await handleCatalogGet({ account }));
      case "history": return NextResponse.json(await handleHistoryGet({ account }));
      case "review-queue": return NextResponse.json(await handleReviewQueueGet({ account }));
      case "print": return NextResponse.json(await handlePrint({ account }));
      default: return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`[Inventory API] GET ${action} error:`, error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  if (!isAuthorized(session.user.email)) return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }

  const action = body.action;
  // Inject email from session
  body.email = session.user.email;

  try {
    switch (action) {
      case "start-session": return NextResponse.json(await handleStartSession(body));
      case "save-count": return NextResponse.json(await handleCountSave(body));
      case "submit": return NextResponse.json(await handleCountSubmit(body));
      case "add-item": return NextResponse.json(await handleAddItem(body));
      case "update-item": return NextResponse.json(await handleUpdateItem(body));
      case "batch-move-items": return NextResponse.json(await handleBatchMoveItems(body));
      case "merge-items": return NextResponse.json(await handleMergeItems(body));
      case "resolve-queue": return NextResponse.json(await handleResolveQueue(body));
      case "save-locations": return NextResponse.json(await handleSaveLocations(body));
      case "save-sort-order": return NextResponse.json(await handleSaveSortOrder(body));
      case "add-subzone": return NextResponse.json(await handleAddSubZone(body));
      case "deactivate-location": return NextResponse.json(await handleDeactivateLocation(body));
      case "exclude-item": return NextResponse.json(await handleExcludeItem(body));
      case "archive-item": return NextResponse.json(await handleArchiveItem(body));
      case "reactivate-item": return NextResponse.json(await handleReactivateItem(body));
      case "verify-price": return NextResponse.json(await handleVerifyPrice(body));
      case "update-catalog-item": return NextResponse.json(await handleUpdateCatalogItem(body));
      case "update-location": return NextResponse.json(await handleUpdateLocation(body));
      case "admin-correct":
        if (session.user.email !== "k.fietek@kitchfix.com") {
          return NextResponse.json({ success: false, error: "Admin only" }, { status: 403 });
        }
        return NextResponse.json(await handleAdminCorrect(body));
      case "scan": return NextResponse.json(await handleScan(body));
      case "dedup-catalog": return NextResponse.json(await handleDedupCatalog(body));
      case "ai-similarity-check": return NextResponse.json(await handleAISimilarityCheck(body));
      case "keep-separate": return NextResponse.json(await handleKeepSeparate(body));
      case "review-accept": return NextResponse.json(await handleReviewAccept(body));
      case "review-delete": return NextResponse.json(await handleReviewDelete(body));
      default: return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`[Inventory API] POST ${action} error:`, error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}