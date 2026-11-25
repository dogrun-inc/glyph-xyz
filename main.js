const statusBox = document.querySelector('#status');
const viewer = document.querySelector('#viewer');
const previewDescription = document.querySelector('#preview-description');
const generateButton = document.querySelector('#generate-btn');
const fontInput = document.querySelector('#font');
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

const viewerReady = initializeViewer();
let worker = null;
let size;

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
        previewDescription.textContent = `一辺 ${size} mm のブロックです。Z 軸方向に直径 ${size / 2} mm の貫通穴があります。`;
        statusBox.textContent = 'テスト立体を表示しました。';
      }
    } catch (error) {
      statusBox.textContent = 'テスト立体の表示に失敗しました。';
      console.error(error);
    } finally {
      if (worker === activeWorker) setGenerationLocked(false);
    }
  });
}

generateButton.addEventListener('click', () => {
  if (generateButton.disabled || !sizeInput.reportValidity()) return;
  if (!worker) {
    initializeWorker();
    return;
  }

  const activeWorker = worker;
  size = sizeInput.valueAsNumber;
  setGenerationLocked(true);
  try {
    statusBox.textContent = 'CAD ジオメトリを計算中...';
    activeWorker.postMessage({ type: 'generate', payload: { size } });
  } catch (error) {
    if (worker !== activeWorker) return;
    statusBox.textContent = error.message;
    setGenerationLocked(false);
  }
});

initializeWorker();
