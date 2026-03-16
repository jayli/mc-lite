/**
 * ManualSaveService - 负责手动存档的逻辑接口
 * 与独立的 ManualSaveWorker 通信，确保不阻塞主线程
 */
import { WorkerRpcClient } from './WorkerRpcClient.js';

export class ManualSaveService {
  constructor() {
    this.rpc = new WorkerRpcClient(new URL('../workers/ManualSaveWorker.js', import.meta.url));
    this.worker = this.rpc.worker;
  }

  /**
   * 向 Worker 发送消息并返回一个 Promise
   */
  postMessage(action, payload) {
    return this.rpc.postMessage(action, payload);
  }

  /**
   * 检查是否存在有效存档
   */
  async checkSaveExists() {
    try {
      return await this.postMessage('CHECK_SAVE');
    } catch (error) {
      console.error('Failed to check save existence:', error);
      return false;
    }
  }

  /**
   * 执行手动存档
   * @param {object} snapshot - 包含 player 和 worldDeltas 的快照对象
   */
  async save(snapshot) {
    try {
      await this.postMessage('SAVE_SNAPSHOT', snapshot);
      return true;
    } catch (error) {
      console.error('Failed to save snapshot:', error);
      throw error;
    }
  }

  /**
   * 加载存档快照
   */
  async load() {
    try {
      return await this.postMessage('LOAD_SNAPSHOT');
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      throw error;
    }
  }
}

export const manualSaveService = new ManualSaveService();
