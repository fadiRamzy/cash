import json, re

CATEGORY_MAP = {
    "PC": "بنوك عامة",
    "SB": "بنوك متخصصة",
    "CB": "بنوك تجارية",
    "IB": "بنوك استثمارية",
    "FB": "بنوك أجنبية",
    "CC": "شركات ائتمان استهلاكي",
    "RC": "شركات ائتمان وتقسيط",
    "MF": "تمويل متناهي الصغر وجمعيات",
    "MG": "شركات تمويل عقاري",
    "LF": "شركات تأجير تمويلي",
    "HS": "شركات إسكان وتعمير",
    "FS": "خدمات مالية غير مصرفية",
    "NB": "هيئات ومؤسسات أخرى",
    "NG": "هيئات ومؤسسات أخرى",
    "RA": "جهات رقابية",
    "UC": "شركات مرافق",
    "IC": "تأمين",
}

def category_for(code):
    suffix = re.sub(r"[^A-Za-z]", "", code)[-2:].upper()
    return CATEGORY_MAP.get(suffix, "أخرى")

entries = []
seen = set()
with open("raw_codes.txt", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or "|" not in line:
            continue
        code, name = line.split("|", 1)
        code = code.strip()
        name = name.strip()
        key = (code, name)
        if key in seen:
            continue
        seen.add(key)
        entries.append({
            "code": code,
            "name": name,
            "category": category_for(code)
        })

entries.sort(key=lambda e: (e["category"], e["code"]))

with open("data/codes.json", "w", encoding="utf-8") as f:
    json.dump({
        "generatedAt": "2026-07-27",
        "totalRecords": len(entries),
        "records": entries
    }, f, ensure_ascii=False, indent=2)

print("Total records:", len(entries))

rating = [
    {"rating": "ممتاز", "min": 751, "max": 850, "riskRate": 2.0},
    {"rating": "جيد جدا", "min": 701, "max": 750, "riskRate": 20.8},
    {"rating": "مرضي", "min": 626, "max": 700, "riskRate": 5.1},
    {"rating": "غير مرضي", "min": 521, "max": 625, "riskRate": 25.8},
    {"rating": "مخاطر مرتفعه", "min": 400, "max": 520, "riskRate": 31.9},
    {"rating": "متعثر", "min": 300, "max": 399, "riskRate": 74.5},
]
with open("data/rating.json", "w", encoding="utf-8") as f:
    json.dump({"scale": "300-850", "bands": rating}, f, ensure_ascii=False, indent=2)
