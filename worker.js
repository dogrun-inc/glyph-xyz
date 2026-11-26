let pyodide;
let pathKitReady;
let generating = false;
const pathKitUrl = 'https://cdn.jsdelivr.net/npm/pathkit-wasm@1.0.0/bin/';

async function simplifyGlyphOutline(svgPath) {
  pathKitReady ??= Promise.resolve().then(() => {
    importScripts(pathKitUrl + 'pathkit.js');
    return PathKitInit({ locateFile: (name) => pathKitUrl + name });
  }).catch((error) => {
    pathKitReady = null;
    throw error;
  });
  const pathKit = await pathKitReady;
  const path = pathKit.FromSVGString(svgPath);
  if (!path) throw new Error('フォントの輪郭を読み込めませんでした。');
  try {
    if (!path.simplify()) throw new Error('フォントの輪郭の重複を除去できませんでした。');
    return path.toSVGString();
  } finally {
    path.delete();
  }
}

async function initializePyodide() {
  try {
    self.postMessage({ type: 'status', status: 'loading', message: 'Pyodide を読み込み中...' });
    // OCP.wasm provides CPython 3.13 wheels for the 2025_0 ABI.
    importScripts("https://cdn.jsdelivr.net/pyodide/v0.29.5/full/pyodide.js");
    const runtime = await loadPyodide();
    await runtime.loadPackage(['micropip', 'fonttools']);
    runtime.registerJsModule('glyph_outlines', { simplifyGlyphOutline });

    self.postMessage({ type: 'status', status: 'loading', message: 'build123d をインストール中...' });
    await runtime.runPythonAsync(`
import micropip

micropip.set_index_urls([
    "https://yeicor.github.io/OCP.wasm",
    "https://pypi.org/simple",
])

await micropip.install("lib3mf==2.4.1")
micropip.add_mock_package(
    "py-lib3mf", "2.4.1", modules={"py_lib3mf": "from lib3mf import *"}
)
await micropip.install(["build123d==0.11.0", "sqlite3"])
from build123d import Align, Plane, Sketch, Text, extrude, import_svg, scale
`);

    self.postMessage({ type: 'status', status: 'loading', message: 'plotly をインストール中...' });
    await runtime.runPythonAsync(`
await micropip.install("plotly==5.24.1")
import json
from io import StringIO
import plotly.graph_objects as go
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont
from glyph_outlines import simplifyGlyphOutline

async def repair_glyphs(chars, font_path, size):
    with TTFont(font_path) as font:
        cmap = font.getBestCmap() or {}
        glyphs = font.getGlyphSet()
        paths = {}
        original_areas = {}
        for char in dict.fromkeys(chars):
            glyph_name = cmap.get(ord(char))
            if glyph_name is None:
                raise ValueError(f"フォントに文字「{char}」が含まれていません。")
            pen = SVGPathPen(glyphs)
            glyphs[glyph_name].draw(pen)
            outline = pen.getCommands()
            area = AreaPen()
            parse_path(outline, area)
            original_areas[char] = area.value
            paths[char] = await simplifyGlyphOutline(outline)

        if "glyf" in font and "fvar" not in font:
            for char, path in paths.items():
                pen = TTGlyphPen(None)
                area = AreaPen()
                parse_path(path, area)
                target = ReverseContourPen(pen) if area.value * original_areas[char] < 0 else pen
                parse_path(path, Cu2QuPen(target, max_err=1.0))
                glyph_name = cmap[ord(char)]
                glyph = pen.glyph()
                glyph.recalcBounds(font["glyf"])
                font["glyf"][glyph_name] = glyph
                width, _ = font["hmtx"][glyph_name]
                font["hmtx"][glyph_name] = width, glyph.xMin
            repaired_path = "/fonts/repaired.ttf"
            font.save(repaired_path)
            return [text_sketch(char, size, repaired_path) for char in chars]

    return [Sketch(import_svg(
        StringIO(f'<svg xmlns="http://www.w3.org/2000/svg"><path d="{paths[char]}"/></svg>'),
        flip_y=False, align=None,
    )) for char in chars]

def text_sketch(char, size, font_path):
    return Text(char, font_size=size, font_path=font_path, align=(Align.CENTER, Align.CENTER))

def glyph_prism(char, size, txt, plane):
    if not txt.faces() or not txt.is_valid:
        raise ValueError(f"文字「{char}」の有効な輪郭を生成できませんでした。")
    bbox = txt.bounding_box()
    if bbox.size.X <= 0 or bbox.size.Y <= 0:
        raise ValueError(f"文字「{char}」の輪郭に幅または高さがありません。")
    centered = txt.translate(-bbox.center())
    normalized = scale(
        centered, by=(size / bbox.size.X, size / bbox.size.Y, 1.0), about=(0, 0, 0)
    )
    if not normalized.is_valid:
        raise ValueError(f"文字「{char}」の輪郭を正規化できませんでした。")
    prism = extrude(plane * normalized, amount=size * 0.6, both=True)
    if not prism.solids() or not prism.is_valid:
        raise ValueError(f"文字「{char}」を押し出して有効な立体を生成できませんでした。")
    return prism

async def generate_figure(size, x_char, y_char, z_char, font_path):
    chars = (x_char, y_char, z_char)
    sketches = [text_sketch(char, size, font_path) for char in chars]
    if any(not sketch.is_valid for sketch in sketches if sketch.faces()):
        # Other glyphs in the same font can have overlapping faces that each pass is_valid.
        sketches = await repair_glyphs(chars, font_path, size)
    prism_x, prism_y, prism_z = [
        glyph_prism(char, size, sketch, plane)
        for char, sketch, plane in zip(chars, sketches, (Plane.YZ, Plane.XZ, Plane.XY))
    ]
    xy = prism_x & prism_y
    result = xy & prism_z if xy and xy.solids() else None
    solids_count = len(result.solids()) if result else 0
    if solids_count == 0:
        return json.dumps({"error": "共通部分が存在しないため立体を生成できませんでした"})

    verts, triangles = result.tessellate(tolerance=0.1)
    x, y, z = zip(*(tuple(vertex) for vertex in verts))
    i, j, k = zip(*triangles)
    fig = go.Figure(go.Mesh3d(
        x=x, y=y, z=z, i=i, j=j, k=k,
        color="#4684cf", flatshading=True, hoverinfo="skip",
        lighting=dict(ambient=0.6, diffuse=0.8, specular=0.15, roughness=0.8, fresnel=0.05),
    ))
    fig.update_layout(
        scene=dict(
            aspectmode="data",
            camera=dict(projection=dict(type="orthographic")),
            xaxis_title="X (mm)",
            yaxis_title="Y (mm)",
            zaxis_title="Z (mm)",
        ),
        uirevision="constant",
        margin=dict(l=0, r=0, t=0, b=0),
        paper_bgcolor="#eef2f7",
        template=None,
    )
    return json.dumps({"figureJson": fig.to_json(), "solidsCount": solids_count})
`);
    runtime.FS.mkdir('/fonts');
    pyodide = runtime;
    self.postMessage({ type: 'status', status: 'ready', message: '準備完了。立体を生成できます。' });
  } catch (error) {
    self.postMessage({
      type: 'status', status: 'error', message: `初期化に失敗しました。 ${error.message}`,
    });
  }
}

self.addEventListener('message', async ({ data }) => {
  if (data.type !== 'generate' || generating) return;

  generating = true;
  try {
    if (!pyodide) throw new Error('CAD エンジンは準備中です。');
    const { size, glyphs, fontBuffer, fontKind } = data.payload;
    if (!Number.isFinite(size) || size < 5 || size > 200) {
      throw new Error('基準サイズは 5〜200 mm で入力してください。');
    }

    const chars = ['X', 'Y', 'Z'].map((axis, index) => {
      const [char] = (glyphs[index] ?? '').trimStart();
      if (!char) throw new Error(`${axis}軸の文字を入力してください。`);
      return char;
    });
    const fontPath = fontKind === 'default'
      ? '/fonts/default.ttf'
      : fontKind === 'otf' ? '/fonts/custom.otf' : '/fonts/custom.ttf';
    pyodide.FS.writeFile(fontPath, new Uint8Array(fontBuffer));

    const generateFigure = pyodide.globals.get('generate_figure');
    try {
      const result = await generateFigure(size, ...chars, fontPath);
      const { error, figureJson, solidsCount } = JSON.parse(result);
      if (error) {
        self.postMessage({ type: 'error', message: error });
      } else {
        self.postMessage({ type: 'result', figureJson, solidsCount, chars, size });
      }
    } finally {
      generateFigure.destroy();
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: `立体の生成に失敗しました。 ${error.message}` });
  } finally {
    generating = false;
  }
});

initializePyodide();
