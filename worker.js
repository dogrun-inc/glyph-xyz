let pyodide;

async function initializePyodide() {
  try {
    self.postMessage({ type: 'status', status: 'loading', message: 'Pyodide を読み込み中...' });
    // OCP.wasm provides CPython 3.13 wheels for the 2025_0 ABI.
    importScripts("https://cdn.jsdelivr.net/pyodide/v0.29.5/full/pyodide.js");
    const runtime = await loadPyodide();
    await runtime.loadPackage('micropip');

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
from build123d import Box, Cylinder
`);

    self.postMessage({ type: 'status', status: 'loading', message: 'plotly をインストール中...' });
    await runtime.runPythonAsync(`
await micropip.install("plotly==5.24.1")
import plotly.graph_objects as go

def generate_figure(size):
    shape = Box(size, size, size) - Cylinder(size * 0.25, size * 2)
    verts, triangles = shape.tessellate(tolerance=0.1)
    x, y, z = zip(*(tuple(vertex) for vertex in verts))
    i, j, k = zip(*triangles)
    fig = go.Figure(go.Mesh3d(
        x=x, y=y, z=z, i=i, j=j, k=k,
        color="#4684cf", flatshading=True, hoverinfo="skip",
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
    return fig.to_json()
`);
    runtime.FS.mkdir('/fonts');
    pyodide = runtime;
    self.postMessage({ type: 'status', status: 'ready', message: '準備完了。テスト立体を生成できます。' });
  } catch (error) {
    self.postMessage({
      type: 'status', status: 'error', message: `初期化に失敗しました。 ${error.message}`,
    });
  }
}

self.addEventListener('message', ({ data }) => {
  if (data.type !== 'generate') return;

  try {
    if (!pyodide) throw new Error('CAD エンジンは準備中です。');
    const { size, fontBuffer, fontKind } = data.payload;
    if (!Number.isFinite(size) || size < 5 || size > 200) {
      throw new Error('基準サイズは 5〜200 mm で入力してください。');
    }

    const fontPath = fontKind === 'default'
      ? '/fonts/default.ttf'
      : fontKind === 'otf' ? '/fonts/custom.otf' : '/fonts/custom.ttf';
    pyodide.FS.writeFile(fontPath, new Uint8Array(fontBuffer));

    const generateFigure = pyodide.globals.get('generate_figure');
    try {
      const figureJson = generateFigure(size);
      self.postMessage({ type: 'result', figureJson });
    } finally {
      generateFigure.destroy();
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: `立体の生成に失敗しました。 ${error.message}` });
  }
});

initializePyodide();
