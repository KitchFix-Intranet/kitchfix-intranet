import json, re
from collections import Counter

d = json.load(open('/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json'))
rows = d['rows']

def in_dollar(r):
    return r.get('review_reason') != 'invoice_over_extracted'

def protein_type(desc):
    if not desc: return 'other'
    d = str(desc).upper()
    if re.search(r'\bEGG\b|\bEGGS\b|\bTOFU\b|\bSEITAN\b|\bTEMPEH\b', d): return 'plant_or_egg'
    if re.search(r'\bBEEF\b|\bSTEAK\b|\bRIBEYE\b|\bBRISKET\b|\bFLANK\b|\bSIRLOIN\b|\bTENDERLOIN\b|\bGROUND BEEF\b|\bHAMBURGER\b|MEATBALL|OXTAIL|SHORT RIB|SHORT-RIB|PASTRAMI', d): return 'beef'
    if re.search(r'\bCHICKEN\b|\bTURKEY\b|\bDUCK\b|\bPOULTRY\b|\bCHIX\b|\bCVP\b|\bBRST\b|\bTHIGH\b|\bWING\b|\bLEG\b|TUKEY|TURKY', d): return 'poultry'
    if re.search(r'\bPORK\b|\bBACON\b|\bSAUSAGE\b|\bHAM\b|PEPPERONI|\bBERKSHIRE\b|PORK BUTT|PORK LOIN|PORK BELLY|PORK CHOP|PROSCIUTTO|SALAMI|CHORIZO', d): return 'pork'
    if re.search(r'\bSALMON\b|\bTUNA\b|\bSHRIMP\b|\bCOD\b|\bFISH\b|\bSEAFOOD\b|\bTILAPIA\b|\bMAHI\b|\bSCALLOP\b|\bLOBSTER\b|\bCRAB\b|SUSHI|\bSNAPPER\b|\bBASS\b|\bTROUT\b|GROUPER|CATFISH|FILEFISH|NETUNO|PORTCLS', d): return 'seafood'
    if re.search(r'\bLAMB\b|\bGOAT\b|\bVENISON\b|\bBISON\b|VEAL', d): return 'other_meat'
    return 'other'

for acct in ['TBR-FL', 'TBJ-FL', 'STL-FL']:
    acct_rows = [r for r in rows if r.get('account_label') == acct and in_dollar(r) and str(r.get('category','')).lower() == 'protein']
    total_spend = sum(float(r.get('extended_price') or 0) for r in acct_rows)
    ep = 'extended_price'
    print()
    print(f'============ {acct} protein-category rows total: {len(acct_rows)}, spend=${total_spend:,.2f} ============')

    buckets = {}
    for r in acct_rows:
        t = protein_type(r.get('description',''))
        buckets.setdefault(t, []).append(r)

    for t, brows in sorted(buckets.items(), key=lambda x: -sum(float(r.get(ep) or 0) for r in x[1])):
        ts = sum(float(r.get(ep) or 0) for r in brows)
        print()
        print(f'  --- {t}: {len(brows)} rows, ${ts:,.2f} ---')
        breakdown = Counter()
        for r in brows:
            key = (r.get('review_reason'), r.get('parsed_weight_source'))
            breakdown[key] += 1
        for (rr, src), n in sorted(breakdown.items(), key=lambda x: -x[1]):
            subrows = [r for r in brows if r.get('review_reason') == rr and r.get('parsed_weight_source') == src]
            ss = sum(float(r.get(ep) or 0) for r in subrows)
            has_wlv = sum(1 for r in subrows if r.get('weight_line_value') and float(r.get('weight_line_value') or 0) > 0)
            has_cw = sum(1 for r in subrows if r.get('catch_weight_marker'))
            has_item = sum(1 for r in subrows if r.get('item_number'))
            print(f'    review_reason={str(rr):26s} parsed_weight_source={str(src):34s}  {n:4d} rows  ${ss:9,.2f}  wlv+={has_wlv:3d} cw+={has_cw:3d} item#+={has_item:3d}')
