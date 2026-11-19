import { createLocalHost } from './host/local.js';
import { Repository } from './core/store.js';
import { startApp } from './ui/app.js';

const host = createLocalHost();
const repo = new Repository(host.storage);
const app = await startApp({ root: document.getElementById('app'), repo, host });
window.__clotheskin = app; // handy for manual inspection and the browser test
