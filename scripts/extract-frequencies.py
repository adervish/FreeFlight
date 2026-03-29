#!/usr/bin/env python3
import openpyxl, json, sys

xlsx_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/all-airport-data.xlsx"
wb = openpyxl.load_workbook(xlsx_path, read_only=True)
ws = wb["Airports"]
headers = None
records = []

for row in ws.iter_rows(values_only=True):
    if headers is None:
        headers = list(row)
        continue
    d = dict(zip(headers, row))
    loc_id = d.get("Loc Id", "")
    if not loc_id:
        continue

    unicom = str(d.get("UNICOM", "") or "").strip()
    ctaf = str(d.get("CTAF", "") or "").strip()
    atct = str(d.get("ATCT", "") or "").strip()

    if unicom and unicom != "None":
        records.append({"a": loc_id, "t": "UNICOM", "f": unicom})
    if ctaf and ctaf != "None":
        records.append({"a": loc_id, "t": "CTAF", "f": ctaf})
    if atct == "Y":
        records.append({"a": loc_id, "t": "TOWER", "f": ""})

json.dump(records, sys.stdout)
