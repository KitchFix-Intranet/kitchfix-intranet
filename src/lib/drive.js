import { google } from "googleapis";

const INVOICE_DRIVE_FOLDER_ID = process.env.GOOGLE_INVOICE_DRIVE_FOLDER_ID;

function getDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

async function getOrCreateFolder(drive, parentId, folderName) {
  const query = `'${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  return folder.data.id;
}

async function ensureInvoiceFolder(drive, account, invoiceDate) {
  // Use submission date (today) for folder structure, NOT the invoice date.
  // Invoice dates can be years old (e.g. a 2017 invoice submitted in 2026
  // should land in 2026/03, not 2017/02).
  const submissionDate = new Date();
  const year = submissionDate.getFullYear().toString();
  const month = String(submissionDate.getMonth() + 1).padStart(2, "0");

  // Extract short account code (e.g., "STL - FL")
  const accountShort = account.split(" - ").slice(0, 2).join(" - ").trim();

  const yearFolderId = await getOrCreateFolder(drive, INVOICE_DRIVE_FOLDER_ID, year);
  const monthFolderId = await getOrCreateFolder(drive, yearFolderId, month);
  const accountFolderId = await getOrCreateFolder(drive, monthFolderId, accountShort);

  return accountFolderId;
}

export async function uploadInvoiceImage(accessToken, base64Data, filename, account, invoiceDate) {
  const drive = getDriveClient(accessToken);
  const folderId = await ensureInvoiceFolder(drive, account, invoiceDate);

  const rawBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(rawBase64, "base64");
  const mimeType = base64Data.startsWith("data:image/png") ? "image/png" : "image/jpeg";

  const { Readable } = await import("stream");
  const stream = Readable.from(buffer);

  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id, webViewLink, webContentLink",
    supportsAllDrives: true,
  });

  try {
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
  } catch (permErr) {
    console.log("[Drive] Skipping permission (inherited from parent):", permErr.message?.slice(0, 80));
  }

  return {
    fileId: file.data.id,
    fileUrl: file.data.webViewLink || `https://drive.google.com/file/d/${file.data.id}/view`,
  };
}

export async function uploadStampedPDF(accessToken, pdfBuffer, vendor, account, invoiceDate, invoiceNumber) {
  const drive = getDriveClient(accessToken);
  const folderId = await ensureInvoiceFolder(drive, account, invoiceDate);

  // Filename still uses invoiceDate so the file itself is identifiable by invoice date
  const dateStr = invoiceDate.replace(/-/g, "");
  const vendorClean = vendor.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  const invNum = invoiceNumber ? `_${invoiceNumber}` : "";
  const filename = `${vendorClean}${invNum}_${dateStr}.pdf`;

  const { Readable } = await import("stream");
  const stream = Readable.from(pdfBuffer);

  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: "application/pdf",
      body: stream,
    },
    fields: "id, webViewLink, webContentLink",
    supportsAllDrives: true,
  });

  try {
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
  } catch (permErr) {
    console.log("[Drive] Skipping permission (inherited from parent):", permErr.message?.slice(0, 80));
  }

  return {
    fileId: file.data.id,
    fileUrl: file.data.webViewLink || `https://drive.google.com/file/d/${file.data.id}/view`,
  };
}

export async function uploadInvoicePages(accessToken, pages, vendor, account, invoiceDate) {
  const results = [];
  const dateStr = invoiceDate.replace(/-/g, "");
  const vendorClean = vendor.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const ext = pages[i].startsWith("data:image/png") ? "png" : "jpg";
    const filename = `${vendorClean}_${dateStr}_p${pageNum}.${ext}`;

    try {
      const result = await uploadInvoiceImage(accessToken, pages[i], filename, account, invoiceDate);
      results.push({ page: pageNum, ...result });
    } catch (error) {
      console.error(`[Drive] Failed to upload page ${pageNum}:`, error.message);
      results.push({ page: pageNum, fileId: null, fileUrl: null, error: error.message });
    }
  }

  return results;
}