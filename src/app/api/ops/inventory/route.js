/**
 * /api/ops/inventory/route.js — Inventory Manager API Sub-Route
 * 
 * Dev-gated: only INV_MANAGER_DEV_USERS can access.
 * Dispatched by `action` query/body parameter.
 * All sheet operations use service account via opsUtils/inventoryActions.
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
  handleCountSave,
  handleCountSubmit,
  handleAddItem,
  handleUpdateItem,
  handleMergeItems,
  handleResolveQueue,
  handleSaveLocations,
  handleSaveSortOrder,
  handleAdminCorrect,
  handleScan,
} from "@/lib/inventoryActions";

// ── Dev Gate ──
const INV_MANAGER_DEV_USERS = ["k.fietek@kitchfix.com"];

function isAuthorized(email) {
  return INV_MANAGER_DEV_USERS.includes(email);
}

// ── GET Handler ──
export async function GET(request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }
  if (!isAuthorized(session.user.email)) {
    return NextResponse.json({ success: false, error: "Not authorized — Inventory Manager is in development" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const account = searchParams.get("account") || "";

  try {
    switch (action) {
      case "bootstrap":
        return NextResponse.json(await handleInventoryBootstrap({ account }));

      case "catalog":
        return NextResponse.json(await handleCatalogGet({ account }));

      case "history":
        return NextResponse.json(await handleHistoryGet({ account }));

      case "review-queue":
        return NextResponse.json(await handleReviewQueueGet({ account }));

      case "print": {
        const locations = searchParams.get("locations")?.split(",") || [];
        const format = searchParams.get("format") || "pdf";
        return NextResponse.json(await handlePrint({ account, locations, format }));
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`[Inventory API] GET ${action} error:`, error.message);
    logEvent(session.accessToken, {
      email: session.user.email,
      category: "ops",
      action: `inv_${action}_error`,
      status: "error",
      errorMsg: error.message,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ── POST Handler ──
export async function POST(request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }
  if (!isAuthorized(session.user.email)) {
    return NextResponse.json({ success: false, error: "Not authorized — Inventory Manager is in development" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;

  try {
    switch (action) {
      case "save-count":
        return NextResponse.json(await handleCountSave(body));

      case "submit":
        return NextResponse.json(await handleCountSubmit(body));

      case "add-item":
        return NextResponse.json(await handleAddItem(body));

      case "update-item":
        return NextResponse.json(await handleUpdateItem(body));

      case "merge-items":
        return NextResponse.json(await handleMergeItems(body));

      case "resolve-queue":
        return NextResponse.json(await handleResolveQueue(body));

      case "save-locations":
        return NextResponse.json(await handleSaveLocations(body));

      case "save-sort-order":
        return NextResponse.json(await handleSaveSortOrder(body));

      case "admin-correct":
        // Double-gate: admin corrections are Kevin-only even after dev gate opens
        if (session.user.email !== "k.fietek@kitchfix.com") {
          return NextResponse.json({ success: false, error: "Admin corrections are restricted" }, { status: 403 });
        }
        return NextResponse.json(await handleAdminCorrect(body));

      case "scan":
        return NextResponse.json(await handleScan(body));

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`[Inventory API] POST ${action} error:`, error.message);
    logEvent(session.accessToken, {
      email: session.user.email,
      category: "ops",
      action: `inv_${action}_error`,
      status: "error",
      errorMsg: error.message,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}