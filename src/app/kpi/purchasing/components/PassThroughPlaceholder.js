"use client";
// src/app/kpi/purchasing/components/PassThroughPlaceholder.js
//
// Honest placeholder for pass_through accounts. The full pass-through
// board is PR 3 - see docs/KPI_PURCHASING_PHASE2_SPEC.md §2 and §6.7.
// Rendering the standard COGS buckets for these accounts produces a
// board of zeros (spec §2, table) - correct accounting, useless
// screen. PR 3 builds the real board (management fee card + reimbursable
// ledger).

export function PassThroughPlaceholder({ account, client }) {
  return (
    <div className="kpi-p-placeholder" role="status">
      <div className="kpi-modelbadge">management fee</div>
      <h2>Board for {account} is in PR 3</h2>
      <p>
        <b>{client || account}</b> is a pass-through account. Food,
        packaging and supplies are billed back to the client, so the
        standard COGS buckets would render as zeros here - correct
        accounting, useless screen.
      </p>
      <p>
        The management fee board (spec §2, §6.7) lands with PR 3 and
        renders a stewardship budget, category split and the
        reimbursable ledger. Nothing to grade until then.
      </p>
    </div>
  );
}
