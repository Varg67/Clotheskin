import { createLocalHost } from './host/local.js';
import { detectWorkshopHost } from './host/workshop.js';
import { Repository } from './core/store.js';
import { startApp } from './ui/app.js';

// Inside the Kindroid Workshop the page around the frame answers; anywhere else this is local mode.
const host = (await detectWorkshopHost()) || createLocalHost();
const repo = new Repository(host.storage);
const app = await startApp({ root: document.getElementById('app'), repo, host });
window.__clotheskin = app; // handy for manual inspection and the browser test
