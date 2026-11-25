const statusBox = document.querySelector('#status');
const viewer = document.querySelector('#viewer');
const previewDescription = document.querySelector('#preview-description');
const generateButton = document.querySelector('#generate-btn');
const fontInput = document.querySelector('#font');
const glyphInputs = ['x', 'y', 'z'].map((axis) => document.querySelector(`#glyph-${axis}`));
const partsWarning = document.querySelector('#parts-warning');
const sizeInput = document.querySelector('#size');
const projectionButton = document.querySelector('#projection');
const viewButtons = document.querySelectorAll('[data-view]');

const zUp = { x: 0, y: 0, z: 1 };
const views = {
  x: { eye: { x: 2, y: 0, z: 0 }, up: zUp },
  y: { eye: { x: 0, y: -2, z: 0 }, up: zUp },
  z: { eye: { x: 0, y: 0, z: 2 }, up: { x: 0, y: 1, z: 0 } },
  iso: { eye: { x: 1.25, y: 1.25, z: 1.25 }, up: zUp },
};

let projection = 'orthographic';

function renderFigure({ data, layout }) {
  const scene = layout.scene;
  const camera = viewer.layout?.scene?.camera ?? scene.camera;
  return Plotly.react(viewer, data, {
    ...layout,
    scene: { ...scene, camera: { ...camera, projection: { type: projection } } },
  }, { responsive: true });
}

function createPreviewFigure() {
  return {
    data: [{
      type: 'mesh3d',
      x: [0, 30, 30, 0, 0, 30, 30, 0],
      y: [0, 0, 30, 30, 0, 0, 30, 30],
      z: [0, 0, 0, 0, 30, 30, 30, 30],
      i: [0, 0, 4, 4, 0, 0, 1, 1, 2, 2, 3, 3],
      j: [2, 3, 5, 6, 1, 5, 2, 6, 3, 7, 0, 4],
      k: [1, 2, 6, 7, 5, 4, 6, 5, 7, 6, 4, 7],
      color: '#4684cf',
      flatshading: true,
      hoverinfo: 'skip',
    }],
    layout: {
      autosize: true,
      uirevision: 'constant',
      paper_bgcolor: '#eef2f7',
      margin: { l: 0, r: 0, t: 56, b: 0 },
      scene: {
        aspectmode: 'data',
        camera: { ...views.iso, projection: { type: projection } },
        xaxis: { title: 'X (mm)' },
        yaxis: { title: 'Y (mm)' },
        zaxis: { title: 'Z (mm)' },
      },
    },
  };
}

async function initializeViewer() {
  try {
    await renderFigure(createPreviewFigure());
  } catch (error) {
    statusBox.textContent = 'プレビューの表示に失敗しました。';
    console.error(error);
    return false;
  }

  projectionButton.disabled = false;
  projectionButton.addEventListener('click', async () => {
    const next = projection === 'orthographic' ? 'perspective' : 'orthographic';
    projectionButton.disabled = true;
    try {
      await Plotly.relayout('viewer', { 'scene.camera.projection.type': next });
      projection = next;
      projectionButton.textContent = next === 'orthographic' ? '平行投影' : '透視投影';
    } finally {
      projectionButton.disabled = false;
    }
  });

  for (const button of viewButtons) {
    button.disabled = false;
    button.addEventListener('click', () => {
      const { eye, up } = views[button.dataset.view];
      return Plotly.relayout('viewer', {
        'scene.camera.eye': eye,
        'scene.camera.up': up,
        'scene.camera.center': { x: 0, y: 0, z: 0 },
      });
    });
  }
  return true;
}

function setGenerationLocked(locked) {
  generateButton.disabled = locked;
  fontInput.disabled = locked;
}

async function readFont(file) {
  if (file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!/\.(ttf|otf)$/i.test(file.name)) {
      throw new Error('拡張子が .ttf または .otf のフォントを選択してください。');
    }
    return { fontBuffer: await file.arrayBuffer(), fontKind: extension };
  }

  try {
    const response = await fetch('./fonts/default.ttf');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { fontBuffer: await response.arrayBuffer(), fontKind: 'default' };
  } catch (error) {
    throw new Error(
      'デフォルトフォント（fonts/default.ttf）が見つかりません。フォントファイルを選択するか、fonts/default.ttf を配置してください',
      { cause: error },
    );
  }
}

const viewerReady = initializeViewer();
let worker = null;

function initializeWorker() {
  setGenerationLocked(true);
  statusBox.textContent = 'Pyodide を読み込み中...';

  function failWorker(message) {
    worker?.terminate();
    worker = null;
    statusBox.textContent = message;
    setGenerationLocked(false);
  }

  try {
    worker = new Worker('./worker.js');
  } catch (error) {
    failWorker(`Worker の起動に失敗しました。 ${error.message}`);
    return;
  }

  const activeWorker = worker;
  activeWorker.addEventListener('error', (event) => {
    if (worker === activeWorker) failWorker(`Worker の実行に失敗しました。 ${event.message}`);
  });

  activeWorker.addEventListener('message', async ({ data }) => {
    if (worker !== activeWorker) return;
    if (data.type === 'status') {
      if (data.status === 'error') {
        failWorker(data.message);
        return;
      }
      if (data.status === 'ready') {
        const ready = await viewerReady;
        if (worker !== activeWorker) return;
        statusBox.textContent = ready ? data.message : 'プレビューの表示に失敗しました。';
        setGenerationLocked(false);
      } else {
        statusBox.textContent = data.message;
      }
      return;
    }

    try {
      if (data.type === 'error') {
        statusBox.textContent = data.message;
      } else if (data.type === 'result') {
        await renderFigure(JSON.parse(data.figureJson));
        const [x, y, z] = data.chars;
        previewDescription.textContent = `基準サイズ ${data.size} mm。X軸は「${x}」、Y軸は「${y}」、Z軸は「${z}」です。`;
        const hasMultipleParts = data.solidsCount > 1;
        partsWarning.textContent = hasMultipleParts
          ? `立体が ${data.solidsCount} 個のパーツに分断されています。太字のフォントや別の文字の組み合わせを試してください`
          : '';
        partsWarning.hidden = !hasMultipleParts;
        statusBox.textContent = '立体を表示しました。';
      }
    } catch (error) {
      statusBox.textContent = '立体の表示に失敗しました。';
      console.error(error);
    } finally {
      if (worker === activeWorker) setGenerationLocked(false);
    }
  });
}

generateButton.addEventListener('click', async () => {
  if (generateButton.disabled || !sizeInput.reportValidity()) return;
  if (!worker) {
    initializeWorker();
    return;
  }

  const activeWorker = worker;
  const size = sizeInput.valueAsNumber;
  const glyphs = glyphInputs.map((input) => input.value);
  setGenerationLocked(true);
  statusBox.textContent = 'フォントを読み込み中...';

  try {
    const { fontBuffer, fontKind } = await readFont(fontInput.files[0]);
    if (worker !== activeWorker) return;
    statusBox.textContent = 'CAD ジオメトリを計算中...';
    activeWorker.postMessage({ type: 'generate', payload: { size, glyphs, fontBuffer, fontKind } }, [fontBuffer]);
  } catch (error) {
    if (worker !== activeWorker) return;
    statusBox.textContent = error.message;
    setGenerationLocked(false);
  }
});

initializeWorker();
