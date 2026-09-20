"""Read public exchange XLSX snapshots without evaluating formulas or external links."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

namespace = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(sys.argv[1]) as archive:
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(t.text or "" for t in item.findall(".//s:t", namespace))
                   for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
    rows = []
    for row in ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).findall(".//s:sheetData/s:row", namespace):
        values = {}
        for cell in row.findall("s:c", namespace):
            value = cell.find("s:v", namespace)
            text = value.text if value is not None else ""
            if cell.get("t") == "s":
                text = strings[int(text)]
            elif cell.get("t") == "inlineStr":
                text = "".join(t.text or "" for t in cell.findall(".//s:t", namespace))
            values["".join(c for c in cell.get("r") if c.isalpha())] = text
        rows.append(values)
with open(sys.argv[2], "w", encoding="utf-8") as output:
    json.dump(rows, output, ensure_ascii=False)
