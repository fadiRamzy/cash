import json, re

with open("data/codes.json", encoding="utf-8") as f:
    data = json.load(f)

def flip(code):
    m = re.match(r"^(\d+)([A-Za-z]+)$", code)
    if m:
        return m.group(2) + m.group(1)
    return code

for r in data["records"]:
    r["code"] = flip(r["code"])

with open("data/codes.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(data["records"][0])
print(data["records"][1])
