const VERSION = '1.2.1';
const SYNC_STORAGE = 'murrays-app-launcher-sync';
const search = document.querySelector('#search');
const sections = [...document.querySelectorAll('main section')];
const customApps = document.querySelector('#custom-apps .tiles');
const syncDialog = document.querySelector('#sync-dialog');
const editDialog = document.querySelector('#edit-dialog');
const editForm = document.querySelector('#edit-form');
const builtInLinks = new Map([...document.querySelectorAll('[data-app-id]')]
  .map(link => ['built-in:' + link.dataset.appId, { link, originalUrl: link.href }]));
let editingAppId = null;
const addDialog = document.querySelector('#add-dialog');
const syncForm = document.querySelector('#sync-form');
const addForm = document.querySelector('#add-form');
const syncButton = document.querySelector('#app-sync');
const status = document.querySelector('#sync-status');
let connection = null;
let requestNumber = 0;
let pendingApp = null;

document.querySelector('#version').textContent = 'Version ' + VERSION;

function filterApps() {
  const words = search.value.trim().toLocaleLowerCase().split(/\s+/);
  for (const section of sections) {
    const tiles = [...section.querySelectorAll('.tile')];
    for (const tile of tiles) {
      const text = [...tile.childNodes].filter(node => node.nodeName !== 'BUTTON')
        .map(node => node.textContent).join(' ').toLocaleLowerCase();
      tile.hidden = !words.every(word => text.includes(word));
    }
    section.hidden = tiles.every(tile => tile.hidden);
  }
  document.querySelector('#empty').hidden = !sections.every(section => section.hidden);
}

function addEditButton(link, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'edit-link';
  button.textContent = 'Edit link';
  button.setAttribute('aria-label', 'Edit link for ' + link.textContent);
  button.addEventListener('click', () => {
    if (!connection) {
      showSync();
      return;
    }
    editingAppId = id;
    editForm.elements.url.value = link.href;
    editForm.querySelector('.form-error').textContent = '';
    document.querySelector('#edit-title').textContent = 'Edit link for ' + link.textContent;
    editDialog.showModal();
  });
  link.closest('.tile').append(button);
}

for (const [id, { link }] of builtInLinks) addEditButton(link, id);

function renderApps(apps) {
  const overrides = new Map(apps.filter(app => app.id.startsWith('built-in:'))
    .map(app => [app.id, app.url]));
  for (const [id, { link, originalUrl }] of builtInLinks) {
    link.href = overrides.get(id) || originalUrl;
  }
  const tiles = [];
  for (const app of apps) {
    if (app.id.startsWith('built-in:')) continue;
    const url = new URL(app.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    const tile = document.createElement('li');
    tile.className = 'tile';
    const link = document.createElement('a');
    link.className = 'app';
    link.href = url.href;
    link.textContent = app.title;
    tile.append(link);
    addEditButton(link, app.id);
    tiles.push(tile);
  }
  customApps.replaceChildren(...tiles);
  filterApps();
}

async function syncApps(config, app, method = app ? 'POST' : 'GET') {
  const response = await fetch(new URL('/apps?include=overrides', config.endpoint), {
    method,
    headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
    body: app ? JSON.stringify(app) : undefined,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) throw new Error('Check your pairing key.');
  if (method === 'PATCH' && response.status === 405) throw new Error('Update the app sync Worker to enable link editing.');
  if (method === 'PATCH' && response.status === 404) throw new Error('This app could not be found. Refresh the launcher and try again.');
  if (response.status === 409) throw new Error('That app link already exists.');
  if (!response.ok) throw new Error('App sync is unavailable. Check your connection and try again.');
  const apps = await response.json();
  if (!Array.isArray(apps)) throw new Error('Check the sync URL.');
  return apps;
}

async function refreshApps() {
  if (!connection) return;
  const request = ++requestNumber;
  try {
    const apps = await syncApps(connection);
    if (request === requestNumber) {
      renderApps(apps);
      status.textContent = '';
    }
  } catch {
    if (request === requestNumber) status.textContent = 'Could not refresh added apps.';
  }
}

function showSync() {
  syncForm.elements.endpoint.value = connection?.endpoint || '';
  syncForm.elements.key.value = '';
  syncForm.querySelector('.form-error').textContent = '';
  syncDialog.showModal();
}

function bindSubmit(form, submit) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const error = form.querySelector('.form-error');
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    error.textContent = '';
    try {
      await submit(form.elements);
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      button.disabled = false;
    }
  });
  const dialog = form.closest('dialog');
  dialog.addEventListener('cancel', event => {
    if (form.querySelector('button[type="submit"]').disabled) event.preventDefault();
  });
  form.querySelector('[data-close]').addEventListener('click', () => {
    if (!form.querySelector('button[type="submit"]').disabled) dialog.close();
  });
}

bindSubmit(syncForm, async fields => {
  const url = new URL(fields.endpoint.value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Enter your HTTPS sync URL.');
  }
  const config = { endpoint: url.origin, key: fields.key.value.toLowerCase() };
  const apps = await syncApps(config);
  localStorage.setItem(SYNC_STORAGE, JSON.stringify(config));
  ++requestNumber;
  connection = config;
  renderApps(apps);
  status.textContent = '';
  syncButton.textContent = 'App sync settings';
  syncForm.reset();
  syncDialog.close();
});

bindSubmit(addForm, async fields => {
  const title = fields.title.value.trim();
  const url = new URL(fields.url.value.trim());
  if (!title || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter an app name and a valid web link.');
  }
  if (pendingApp?.title !== title || pendingApp?.url !== url.href) {
    pendingApp = { id: crypto.randomUUID(), title, url: url.href };
  }
  ++requestNumber;
  const apps = await syncApps(connection, pendingApp);
  ++requestNumber;
  search.value = '';
  renderApps(apps);
  status.textContent = 'App saved.';
  pendingApp = null;
  addForm.reset();
  addDialog.close();
});

bindSubmit(editForm, async fields => {
  const url = new URL(fields.url.value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
    throw new Error('Enter a valid web link.');
  }
  ++requestNumber;
  const apps = await syncApps(connection, { id: editingAppId, url: url.href }, 'PATCH');
  ++requestNumber;
  renderApps(apps);
  status.textContent = 'Link saved.';
  editDialog.close();
});

search.addEventListener('input', filterApps);
syncButton.addEventListener('click', showSync);
document.querySelector('#add-app').addEventListener('click', () => {
  if (!connection) {
    showSync();
    return;
  }
  addForm.querySelector('.form-error').textContent = '';
  addDialog.showModal();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshApps();
});
window.addEventListener('online', refreshApps);
try {
  connection = JSON.parse(localStorage.getItem(SYNC_STORAGE));
} catch {
  connection = null;
}
if (connection) syncButton.textContent = 'App sync settings';
refreshApps();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);

