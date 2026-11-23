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
`);
    self.postMessage({ type: 'status', status: 'ready', message: '準備完了。テスト立体を生成できます。' });
  } catch (error) {
    self.postMessage({
      type: 'status', status: 'error', message: `初期化に失敗しました。 ${error.message}`,
    });
  }
}

initializePyodide();
