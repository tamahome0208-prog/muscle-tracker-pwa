// 体の写真専用のIndexedDBラッパー。
// 【重要】このファイルは外部通信APIを一切使わない。体の写真は端末外に出さない。

const DB_NAME = 'mt-photos';
const STORE = 'photos';
const MAX_EDGE = 1080;
const QUALITY = 0.8;

export const ANGLES = [
  { id: 'front', label: '正面' },
  { id: 'side', label: '横' },
  { id: 'back', label: '背面' }
];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('date', 'date');
        os.createIndex('angle', 'angle');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function isAvailable() {
  try {
    const db = await openDb();
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** 長辺1080pxへ縮小しJPEG圧縮したBlobを返す（1枚おおよそ200KB） */
export async function compressImage(source) {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  return { blob, width, height };
}

export async function savePhoto({ date, angle, source }) {
  const { blob, width, height } = await compressImage(source);
  const db = await openDb();
  const id = await wrap(tx(db, 'readwrite').add({ date, angle, blob, width, height }));
  db.close();
  return id;
}

export async function listPhotos() {
  const db = await openDb();
  const all = await wrap(tx(db, 'readonly').getAll());
  db.close();
  return all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function latestByAngle(angle) {
  const all = await listPhotos();
  const hits = all.filter((p) => p.angle === angle);
  return hits.length ? hits[hits.length - 1] : null;
}

export async function firstByAngle(angle) {
  const all = await listPhotos();
  return all.find((p) => p.angle === angle) ?? null;
}

export async function deletePhoto(id) {
  const db = await openDb();
  await wrap(tx(db, 'readwrite').delete(id));
  db.close();
}

export function toUrl(photo) {
  return URL.createObjectURL(photo.blob);
}
