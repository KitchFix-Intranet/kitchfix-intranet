"use client";
import React, { useEffect, useRef } from "react";

export default function InvoicePreview({ page, account, vendor, invoiceNumber, invoiceDate, totalAmount, glRows }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!page || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = () => {
      const maxWidth = 800;
      const scale = Math.min(1, maxWidth / img.width);
      const imgW = img.width * scale;
      const imgH = img.height * scale;
      const footerH = 140;

      canvas.width = imgW;
      canvas.height = imgH + footerH;

      // Draw image
      ctx.drawImage(img, 0, 0, imgW, imgH);

      // Draw footer background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, imgH, imgW, footerH);

      // Top border line
      ctx.fillStyle = "#d97706";
      ctx.fillRect(0, imgH, imgW, 3);

      // Account + Vendor
      ctx.fillStyle = "#0f3057";
      ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(account || "—", 16, imgH + 28);

      ctx.fillStyle = "#475569";
      ctx.font = "600 14px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(`${vendor || "—"}  •  ${invoiceDate || "—"}  •  #${invoiceNumber || "—"}`, 16, imgH + 52);

      // Total amount (right-aligned, large)
      const fmtTotal = `$${Number(totalAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      ctx.fillStyle = "#0f3057";
      ctx.font = "bold 28px -apple-system, BlinkMacSystemFont, sans-serif";
      const totalWidth = ctx.measureText(fmtTotal).width;
      ctx.fillText(fmtTotal, imgW - totalWidth - 16, imgH + 36);

      // GL breakdown (compact)
      const validRows = (glRows || []).filter((r) => r.code && Number(r.amount) > 0);
      if (validRows.length > 0) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "600 11px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText("GL CODING", 16, imgH + 78);

        ctx.fillStyle = "#334155";
        ctx.font = "500 12px -apple-system, BlinkMacSystemFont, sans-serif";
        let y = imgH + 94;
        const maxCodesToShow = Math.min(validRows.length, 4);

        for (let i = 0; i < maxCodesToShow; i++) {
          const r = validRows[i];
          const amt = `$${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
          ctx.fillText(`${r.code} ${r.name ? "— " + r.name : ""}`, 16, y);
          const amtW = ctx.measureText(amt).width;
          ctx.fillText(amt, imgW - amtW - 16, y);
          y += 16;
        }

        if (validRows.length > 4) {
          ctx.fillStyle = "#94a3b8";
          ctx.fillText(`+ ${validRows.length - 4} more`, 16, y);
        }
      }

      // KitchFix watermark
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("KitchFix Ops Hub", imgW - 110, imgH + footerH - 8);
    };

    img.src = page;
  }, [page, account, vendor, invoiceNumber, invoiceDate, totalAmount, glRows]);

  if (!page) return null;

  return (
    <div className="oh-inv-preview">
      <p className="oh-inv-section-label">STAMP PREVIEW</p>
      <div className="oh-inv-preview-canvas-wrap">
        <canvas ref={canvasRef} style={{ width: "100%", display: "block", borderRadius: 8 }} />
      </div>
    </div>
  );
}