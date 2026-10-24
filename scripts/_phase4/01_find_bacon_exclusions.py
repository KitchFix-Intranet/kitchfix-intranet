"""Find the 16 TBJ-FL bacon rows excluded by Phase 3c's OCR-garble rule.
Same predicate as scripts_phase3c/10_apply_suppressions.mjs lines 279-284."""
import json, re

d = json.load(open('/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json'))

def is_pork(desc):
    if not desc: return False
    d = str(desc).upper()
    if re.search(r'\bBEEF\b|\bSTEAK\b|\bRIBEYE\b|\bBRISKET\b|\bFLANK\b|\bSIRLOIN\b|\bTENDERLOIN\b|\bGROUND BEEF\b|\bHAMBURGER\b|MEATBALL|OXTAIL|SHORT RIB|SHORT-RIB|PASTRAMI', d): return False
    if re.search(r'\bCHICKEN\b|\bTURKEY\b|\bDUCK\b|\bPOULTRY\b|\bCHIX\b|\bCVP\b|\bBRST\b|\bTHIGH\b|\bWING\b|\bLEG\b|TUKEY|TURKY', d): return False
    if re.search(r'\bPORK\b|\bBACON\b|\bSAUSAGE\b|\bHAM\b|PEPPERONI|\bBERKSHIRE\b|PORK BUTT|PORK LOIN|PORK BELLY|PORK CHOP|PROSCIUTTO|SALAMI|CHORIZO', d): return True
    return False

acct_rows = [r for r in d if r.get('account_label') == 'TBJ-FL' and r.get('category') == 'protein' and r.get('_basis') == 'food' and is_pork(r.get('description'))]
w_rows = [r for r in acct_rows if (r.get('_effective_weight_lb') or 0) > 0]

def is_bad(r):
    pack = str(r.get('pack_size') or '').strip().upper()
    wlv = r.get('weight_line_value')
    ep = r.get('extended_price')
    wlv_eq_ext = wlv is not None and ep is not None and abs(float(wlv) - float(ep)) < 0.01
    if re.match(r'^\d{3,}\s*LB$', pack): return True, 'bare_3digit_LB'
    if re.match(r'^\d+\s*(CS|BX|CA)\s+\d+\s*LB$', pack): return True, 'CS_BX_CA_LB_shape'
    if wlv_eq_ext: return True, 'wlv_eq_ext'
    return False, ''

bad = []
for r in w_rows:
    b, why = is_bad(r)
    if b:
        bad.append({**r, '_why': why})

print(f'TBJ-FL pork rows in phase3c dump: {len(acct_rows)}')
print(f'TBJ-FL pork with effective_weight_lb>0: {len(w_rows)}')
print(f'Excluded by Phase 3c rule: {len(bad)}')
print()
print(f"{'id':38s} {'invoice_uuid':38s} {'desc':38s} {'pack':10s} {'qty':6s} {'wlv':10s} {'ep':10s} {'eff_lb':10s} why")
by_uuid = {}
for r in bad:
    print(f"{r['id']:38s} {(r.get('invoice_uuid') or '(none)'):38s} {(r.get('description') or '')[:38]:38s} {str(r.get('pack_size') or ''):10s} {str(r.get('quantity') or ''):6s} {str(r.get('weight_line_value') or ''):10s} {str(r.get('extended_price') or ''):10s} {str(r.get('_effective_weight_lb') or ''):10s} {r['_why']}")
    by_uuid.setdefault(r.get('invoice_uuid'), []).append(r['id'])

print()
print(f'Distinct invoice_uuids: {len(by_uuid)}')
for uuid, ids in by_uuid.items():
    print(f'  {uuid}: {len(ids)} rows')

# Save to file for downstream use
json.dump({
    'excluded_bacon_rows': bad,
    'invoice_uuids': list(by_uuid.keys()),
}, open('/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_bacon_exclusions.json', 'w'))
