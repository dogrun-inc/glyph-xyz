const statusBox = document.querySelector('#status');
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

function renderFigure(figureJson) {
  return Plotly.react('viewer', figureJson.data, figureJson.layout, { responsive: true });
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
    document.querySelector('#generate-btn').disabled = true;
    console.error(error);
    return;
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
}

document.querySelector('#generate-btn').addEventListener('click', () => {
  statusBox.textContent = '現在は立方体のプレビューを表示しています。';
});

initializeViewer();
