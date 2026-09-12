from pathlib import Path

p = Path('web/sim_v3.js')
text = p.read_text(encoding='utf-8')
needle = '''  const initialInstances = instances.filter((item) => item.isInitial);\n  const restInstances = instances.filter((item) => !item.isInitial);\n  const observedInitial = observed.slice(0, initialInstances.length);'''
replacement = '''  const initialInstances = instances.filter((item) => item.isInitial);\n  const restInstances = instances.filter((item) => !item.isInitial);\n  if (initialInstances.length >= 8) {\n    throw new Error(\"開始時手札が8枚以上のケースは、実機で2ターン目の開始時手札が2/3枚に分岐する条件をまだ特定できていないため、誤ったSeedを返さないよう探索を停止します。\");\n  }\n  const observedInitial = observed.slice(0, initialInstances.length);'''
if replacement in text:
    print('guard already applied')
elif needle not in text:
    raise SystemExit('guard insertion marker not found')
else:
    p.write_text(text.replace(needle, replacement, 1), encoding='utf-8')
    print('guard applied')
