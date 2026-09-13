#!/usr/bin/env python3
"""One-time migration: loads people.json, transactions.json, committee_analysis.json
(pulled from the live Google Apps Script endpoint) into the Supabase tables created
by schema.sql. Safe to re-run — every insert uses upsert (merge-duplicates) on the
table's primary key.
"""
import json
import urllib.request
import urllib.error

SUPABASE_URL = "https://ihumcgtfhpvizfxguuja.supabase.co"
API_KEY = "sb_publishable_TievwBoXYugLfpG3zZuiEw_onxb40Dt"


def post(table, rows, on_conflict=None):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
    body = json.dumps(rows).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", API_KEY)
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"  {table}: {len(rows)} rows -> {resp.status}")
    except urllib.error.HTTPError as e:
        print(f"  {table}: FAILED {e.code} {e.reason}\n    {e.read().decode()[:500]}")
        raise


def as_date_or_none(s):
    s = (s or "").strip()
    if not s:
        return None
    if len(s) == 7:  # YYYY-MM -> first of month
        s = s + "-01"
    return s


def main():
    people = json.load(open("people.json"))["people"]
    transactions = json.load(open("transactions.json"))["transactions"]
    analysis = json.load(open("committee_analysis.json"))
    committees = analysis["committees"]
    instalments = analysis["instalments"]
    months = analysis["months"]

    # transactions reference people by name (FK) — make sure every person a
    # transaction points at exists, even if missing from the People sheet.
    known = {p["name"] for p in people}
    extra = sorted({t["person"] for t in transactions if t["person"] not in known} |
                   {i["person"] for i in instalments if i["person"] not in known})

    print("1/5 people")
    post("people", [{"name": p["name"], "active": p["active"]} for p in people] +
                    [{"name": n, "active": True} for n in extra])

    print("2/5 committees")
    post("committees", [{
        "no": c["no"], "total_members": c["totalMembers"], "total_months": c["totalMonths"],
        "monthly_amount": c["monthlyAmount"], "total_amount": c["totalAmount"],
        "cut_percent": c["cutPercent"], "extra_profit": c["extraProfit"],
        "start_month": as_date_or_none(c["startMonth"]), "status": c["status"],
    } for c in committees])

    print("3/5 transactions")
    post("transactions", [{
        "id": t["id"], "date": t["date"], "type": t["type"], "person": t["person"],
        "category": t["category"], "amount": t["amount"], "note": t["note"],
        "created_at": t["createdAt"], "verified": t["verified"],
    } for t in transactions], on_conflict="id")

    print("4/5 committee_instalments")
    post("committee_instalments", [{
        "no": i["no"], "person": i["person"], "is_taken": i["isTaken"], "amount": i["amount"],
        "taken_month": i["takenMonth"], "kist": i["kist"], "ghata": i["ghata"],
        "sarkari": i["sarkari"], "status": i["status"], "pending_month": str(i["pendingMonth"]),
    } for i in instalments], on_conflict="no,person")

    print("5/5 committee_months")
    # The source sheet has some duplicate (no, month) rows left over from
    # earlier bugs — for each duplicate, keep whichever has actual data.
    dedup = {}
    for m in months:
        key = (m["no"], m["month"])
        if key not in dedup or (not dedup[key]["boliDate"] and not dedup[key]["ghata"]):
            dedup[key] = m
    print(f"  ({len(months)} rows, {len(dedup)} after de-duplicating)")
    post("committee_months", [{
        "no": m["no"], "month": m["month"], "boli_date": as_date_or_none(m["boliDate"]),
        "sarkari_ghata": m["sarkariGhata"], "ghata": m["ghata"], "kist": m["kist"],
        "taken_by": m["takenBy"], "amount_received": m["amountReceived"], "verified": m["verified"],
    } for m in dedup.values()], on_conflict="no,month")

    print("\nDone.")


if __name__ == "__main__":
    main()
