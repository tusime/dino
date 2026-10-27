# -*- coding: utf-8 -*-
"""
把 src/ 里的源码打包成单文件、零外链的 HTML。

用法：
    python tools/build.py            同时产出 dist/ 和根目录（部署用）
    python tools/build.py --dist-only  只产出 dist/，不动根目录

产出：
    dist/chrome-dino.html    成品（带名字，方便本地双击/分发）
    ./index.html             部署入口（GitHub Pages 等要求根路径为 index.html）

做的事：
    1. 内联 CSS 和 JS
    2. 精灵图转 base64 data URI
    3. 删除 Google Fonts 外链和一条指向不存在资源的死 CSS 引用

来源：wayou/t-rex-runner（BSD-3），原始逻辑出自 Chromium
      components/neterror/resources/offline.js
"""
import base64
import re
import sys
from pathlib import Path

DIST_ONLY = "--dist-only" in sys.argv

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
OUT_NAME = "chrome-dino.html"

REQUIRED = ["index.html", "index.css", "index.js", "sprite-1x.png", "sprite-2x.png"]
missing = [f for f in REQUIRED if not (SRC / f).is_file()]
if missing:
    sys.exit(f"[error] src/ 里缺少文件: {', '.join(missing)}")

html = (SRC / "index.html").read_text(encoding="utf-8")
css = (SRC / "index.css").read_text(encoding="utf-8")
js = (SRC / "index.js").read_text(encoding="utf-8")

# 兜底清理：早期源码里有一条指向不存在资源的死 CSS 引用
# （src/index.css 已删，这里保留兼容，以便对旧版本源码打包）
css, n0 = re.subn(r"content:\s*-webkit-image-set\([\s\S]*?\);", "", css)

b1 = base64.b64encode((SRC / "sprite-1x.png").read_bytes()).decode()
b2 = base64.b64encode((SRC / "sprite-2x.png").read_bytes()).decode()

# favicon（可选）：有就内联，保证成品依然是单文件零外链
favicon = SRC / "favicon.ico"
fav_b64 = base64.b64encode(favicon.read_bytes()).decode() if favicon.is_file() else None

# 防御：JS 里若出现 </script> 字面量会提前截断内联脚本
assert "</script>" not in js, "index.js 含有 </script>，无法安全内联"

# 1) 内联样式表
html, n1 = re.subn(
    r'<link rel="stylesheet" href="index\.css">',
    "<style>\n" + css + "\n</style>",
    html,
)

# 2) 去掉外部字体，保证完全离线
html, n2 = re.subn(r'\s*<link href="https://fonts\.googleapis\.com[^>]*>\s*', "\n", html)

# 3) 内联游戏脚本
html, n3 = re.subn(
    r'<script src="index\.js"></script>',
    "<script>\n" + js + "\n</script>",
    html,
)

# 4) 精灵图转 data URI（Chrome 自己的错误页也是这么嵌的）
#    兼容两种写法：src/ 里的简写路径，以及原仓库的 assets/... 深层路径
html, n4 = re.subn(
    r'src="(?:assets/default_100_percent/100-offline-sprite|sprite-1x)\.png"',
    'src="data:image/png;base64,' + b1 + '"',
    html,
)
html, n5 = re.subn(
    r'src="(?:assets/default_200_percent/200-offline-sprite|sprite-2x)\.png"',
    'src="data:image/png;base64,' + b2 + '"',
    html,
)

# 5) favicon 转 data URI（浏览器默认会请求 /favicon.ico，内联可避免 404）
n6 = 0
if fav_b64:
    html, n6 = re.subn(
        r'<link rel="icon"[^>]*href="favicon\.ico"[^>]*>',
        '<link rel="icon" href="data:image/x-icon;base64,' + fav_b64 + '">',
        html,
    )
    if n6 == 0:
        # 源码里没有声明时，主动插一份，避免浏览器请求 /favicon.ico 报 404
        html = html.replace(
            "</head>",
            '    <link rel="icon" href="data:image/x-icon;base64,' + fav_b64 + '">\n</head>',
            1,
        )
        n6 = 1

DIST.mkdir(exist_ok=True)
out = DIST / OUT_NAME

reps = [n0, n1, n2, n3, n4, n5, n6]
# n0（死引用清理）和 n2（外链字体）都是兼容旧源码的兜底步骤，
# 现在的 src/ 里已经干净，未命中属正常
critical = [n1, n3, n4, n5, n6]
if 0 in critical:
    print(f"[warn] 关键替换未命中: {reps} —— 源码可能被改动过，请检查")

out.write_text(html, encoding="utf-8")

leftover = [ref for ref in ("index.css", "index.js", "assets/default", "fonts.googleapis", 'href="favicon.ico"')
            if ref in html]
print(f"替换次数: {reps}")
print(f"产出: {out.relative_to(ROOT)}  ({out.stat().st_size:,} bytes)")

# 部署入口：静态托管平台要求根路径能直接访问到页面，所以文件名必须是 index.html
if DIST_ONLY:
    print("（--dist-only：跳过根目录 index.html）")
else:
    deploy_entry = ROOT / "index.html"
    deploy_entry.write_text(html, encoding="utf-8")
    print(f"产出: {deploy_entry.relative_to(ROOT)}  ({deploy_entry.stat().st_size:,} bytes)  ← 部署入口")

print(f"残留外链: {leftover or '无，完全自包含'}")
