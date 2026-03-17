// src/services/WorkerRpcClient.js
/**
 * Worker RPC 客户端
 * 封装 Worker 请求/响应的通用消息流程，保持 action/payload/messageId 协议
 */
export class WorkerRpcClient {
  /**
   * @param {URL} workerUrl - Worker 模块 URL
   */
  constructor(workerUrl) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.messageId = 0;
    this.callbacks = new Map();

    this.worker.onmessage = (event) => {
      const { success, result, error, messageId } = event.data;
      if (!this.callbacks.has(messageId)) return;

      const { resolve, reject } = this.callbacks.get(messageId);
      if (success) {
        resolve(result);
      } else {
        reject(new Error(error));
      }
      this.callbacks.delete(messageId);
    };
  }

  /**
   * 向 Worker 发送消息并返回 Promise
   * @param {string} action - Worker 动作
   * @param {object} payload - 数据载荷
   * @returns {Promise<any>}
   */
  postMessage(action, payload) {
    return new Promise((resolve, reject) => {
      const messageId = this.messageId++;
      this.callbacks.set(messageId, { resolve, reject });
      this.worker.postMessage({ action, payload, messageId });
    });
  }
}
