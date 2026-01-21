import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DB_NAME = 'rgmgapp';
const STORE_NAME = 'kv';

let dbPromise = null;

const openDb = () => {
  if (Platform.OS !== 'web' || typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const idbGet = async (key) => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
};

const idbSet = async (key, value) => {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const idbRemove = async (key) => {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const storageGetItem = async (key) => {
  if (Platform.OS === 'web' && typeof indexedDB !== 'undefined') {
    return idbGet(key);
  }
  return AsyncStorage.getItem(key);
};

export const storageSetItem = async (key, value) => {
  if (Platform.OS === 'web' && typeof indexedDB !== 'undefined') {
    return idbSet(key, value);
  }
  return AsyncStorage.setItem(key, value);
};

export const storageRemoveItem = async (key) => {
  if (Platform.OS === 'web' && typeof indexedDB !== 'undefined') {
    return idbRemove(key);
  }
  return AsyncStorage.removeItem(key);
};

export const migrateStorageToIndexedDb = async (keys) => {
  if (Platform.OS !== 'web' || typeof indexedDB === 'undefined') return;
  for (const key of keys) {
    const existing = await idbGet(key);
    if (existing !== null && existing !== undefined) continue;
    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null && legacy !== undefined) {
      await idbSet(key, legacy);
      await AsyncStorage.removeItem(key);
    }
  }
};
