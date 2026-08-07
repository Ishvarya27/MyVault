/* =========================================================
   db.js — MyVault persistence layer
   ---------------------------------------------------------
   Storage engine : IndexedDB (built into every modern browser,
                     no server / backend / external DB needed).
   Persistence    : Data is written to disk by the browser itself,
                     so it survives page reloads, tab closes, and
                     even fully quitting the browser or app — it
                     is only cleared if the user clears site data
                     or explicitly hits "Erase all data" in Settings.
   Scope          : Every other module (app.js) talks to storage
                     only through the functions exported here —
                     nothing else in the app touches indexedDB directly.
   ========================================================= */

const DB_NAME = 'myvault-db';
const DB_VERSION = 2;
let db;

/**
 * Opens (and if needed, creates/upgrades) the local database.
 * Must resolve before any other db.js function is called —
 * app.js awaits this once during startup (see init() in app.js).
 */
function openDB(){
  return new Promise((resolve, reject)=>{
    if(!('indexedDB' in window)){
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;
      // Object stores = the "tables" of MyVault's data model.
      if(!d.objectStoreNames.contains('months')) d.createObjectStore('months', {keyPath:'id'});     // one record per "YYYY-MM"
      if(!d.objectStoreNames.contains('goals')) d.createObjectStore('goals', {keyPath:'id'});         // savings goals
      if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', {keyPath:'key'});          // misc key/value (reminders, settings)
      if(!d.objectStoreNames.contains('holdings')) d.createObjectStore('holdings', {keyPath:'id'});   // already-made investments (FD/RD/gold/etc)
    };
    req.onsuccess = (e)=>{ db = e.target.result; resolve(db); };
    req.onerror = (e)=> reject(e);
  });
}

/** Internal helper: opens a transaction on a given store. */
function txStore(name, mode='readonly'){
  return db.transaction(name, mode).objectStore(name);
}

/** Read a single record by its key. Resolves `null` if not found. */
function idbGet(store, key){
  return new Promise((res, rej)=>{
    const r = txStore(store).get(key);
    r.onsuccess = ()=> res(r.result || null);
    r.onerror = rej;
  });
}

/** Read every record in a store. */
function idbGetAll(store){
  return new Promise((res, rej)=>{
    const r = txStore(store).getAll();
    r.onsuccess = ()=> res(r.result || []);
    r.onerror = rej;
  });
}

/** Insert or update a record (upsert, keyed by the store's keyPath). */
function idbPut(store, val){
  return new Promise((res, rej)=>{
    const r = txStore(store, 'readwrite').put(val);
    r.onsuccess = ()=> res(val);
    r.onerror = rej;
  });
}

/** Delete a single record by key. */
function idbDelete(store, key){
  return new Promise((res, rej)=>{
    const r = txStore(store, 'readwrite').delete(key);
    r.onsuccess = ()=> res();
    r.onerror = rej;
  });
}

/** Wipe every record in a store (used by "Erase all data"). */
function idbClear(store){
  return new Promise((res, rej)=>{
    const r = txStore(store, 'readwrite').clear();
    r.onsuccess = ()=> res();
    r.onerror = rej;
  });
}
