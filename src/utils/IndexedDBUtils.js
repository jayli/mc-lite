/**
 * IndexedDB 工具函数集
 * 提供统一的 IndexedDB 操作封装，减少重复代码
 */

/**
 * 打开数据库并返回 Promise
 * @param {string} dbName - 数据库名称
 * @param {number} dbVersion - 数据库版本
 * @param {Function} onUpgrade - 升级回调 (db, oldVersion, newVersion)
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase(dbName, dbVersion, onUpgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      onUpgrade(db, event.oldVersion, event.newVersion);
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * 将 IDBRequest 包装为 Promise
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
export function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 执行数据库事务操作
 * @param {IDBDatabase} db - 数据库实例
 * @param {string} storeName - 存储对象名称
 * @param {string} mode - 事务模式 ('readonly' | 'readwrite')
 * @param {Function} operation - 操作回调 (store) => IDBRequest
 * @returns {Promise<any>}
 */
export function performTransaction(db, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
