from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"target not found in {path}: {old}")
    p.write_text(text.replace(old, new, 1))

# Force the browser to fetch the post-2-card app module instead of a cached copy.
replace(
    "web/index.html",
    '<script type="module" src="./app_v3.js"></script>',
    '<script type="module" src="./app_v3.js?v=20260909-tower-2card-1"></script>',
)

# app_v3 itself may be fresh while the imported runtime module is cached, so
# version the runtime import independently as well.
replace(
    "web/app_v3.js",
    '} from "./tower_runtime.js";',
    '} from "./tower_runtime.js?v=20260909-tower-2card-1";',
)

# Add regression checks so future changes do not silently remove cache busting.
p = Path("test_web.mjs")
text = p.read_text()
needle = 'assert.match(indexHtml, /現在のドル道仕様に対応する基本カード2枚/);\n'
if needle not in text:
    raise SystemExit("test_web insertion target not found")
text = text.replace(
    needle,
    needle + 'assert.match(indexHtml, /app_v3\\.js\\?v=20260909-tower-2card-1/);\n'
)
p.write_text(text)

p = Path("test_tower_runtime.mjs")
text = p.read_text()
# Existing test already asserts all six 2-card mappings. Add a guard against the
# obsolete produce_default family reappearing in the runtime source.
if 'readFileSync' not in text:
    text = 'import { readFileSync } from "node:fs";\n' + text
append = '''\nconst towerRuntimeSource = readFileSync(new URL("./web/tower_runtime.js", import.meta.url), "utf8");
assert.doesNotMatch(towerRuntimeSource, /initial_deck-produce_default-/);
console.log("tower 2-card cache/mapping regression: ok");
'''
if 'tower 2-card cache/mapping regression: ok' not in text:
    text += append
p.write_text(text)
