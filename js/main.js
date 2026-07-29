import { createStore } from './store.js';
import { initTabs, todayStr } from './ui.js';
import { initMealTab } from './mealTab.js';
import { initWorkoutTab } from './workoutTab.js';
import { initPhotoTab, stopCamera } from './photoTab.js';

export const store = createStore();

async function loadSeed() {
  if (store.get('exercises').length === 0) {
    store.set('exercises', await (await fetch('data/exercises.json')).json());
  }
  if (store.get('foods').length === 0) {
    store.set('foods', await (await fetch('data/foods.json')).json());
  }
  const profile = store.get('profile');
  if (!profile.startDate) {
    store.set('profile', { ...profile, startDate: todayStr() });
  }
}

async function boot() {
  const repaired = store.validate();
  if (repaired.length) {
    console.warn('破損したデータを初期化しました:', repaired);
  }
  await loadSeed();
  initMealTab(store);
  initWorkoutTab(store);
  initPhotoTab(store);
  initTabs();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.querySelectorAll('#tabbar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab !== 'photo') stopCamera();
    });
  });
}

boot();
