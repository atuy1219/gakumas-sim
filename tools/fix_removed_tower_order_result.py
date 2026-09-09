from pathlib import Path

p = Path("web/app_v3.js")
text = p.read_text()
old = '  $("tower-order-result").hidden = true;\n'
if old not in text:
    raise SystemExit("stale tower-order-result reference not found")
text = text.replace(old, "", 1)
p.write_text(text)

p = Path("test_web.mjs")
text = p.read_text()
needle = 'assert.match(towerHtml, /id="tower-memory-count"[^>]*>[\\s\\S]*?<option value="4">4枚<\\/option>/);\n'
if needle not in text:
    raise SystemExit("test insertion target not found")
insert = needle + '''const appV3Source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./web/app_v3.js", import.meta.url), "utf8"));
assert.doesNotMatch(appV3Source, /tower-order-result/);
'''
text = text.replace(needle, insert, 1)
p.write_text(text)
