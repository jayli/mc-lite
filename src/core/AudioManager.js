// src/core/AudioManager.js
import * as THREE from 'three';

/**
 * 音频管理器，负责全局音效的预加载和管理
 */
export class AudioManager {
  constructor() {
    this.sounds = new Map();
    this.audioLoader = new THREE.AudioLoader();
    this.listener = null;
    this.activeSounds = new Map(); // Key: name, Value: Set of active THREE.Audio instances
  }

  /**
   * 初始化 AudioListener
   * @param {THREE.Camera} camera
   */
  init(camera) {
    if (this.listener) return;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
  }

  /**
   * 预加载音效文件
   * @param {string[]} urls
   */
  async preloadSounds(urls) {
    return Promise.all(urls.map(url =>
      this.audioLoader.loadAsync(url).then(buffer => {
        // 从路径提取名称作为 Key (例如 'explosion.mp3' -> 'explosion')
        const name = url.split('/').pop().split('.')[0];
        this.sounds.set(name, buffer);
      })
    ));
  }

  /**
   * 获取并播放一个非空间音效
   * @param {string} name - 音效名称 (文件名去掉后缀)
   * @param {number} volume - 音量 (0-1)
   * @param {boolean} loop - 是否循环
   */
  playSound(name, volume = 0.4, loop = false) {
    if (!this.listener || !this.sounds.has(name)) return;

    // 如果是循环音效且已经在播放，则不重复创建
    if (loop) {
      const instanceSet = this.activeSounds.get(name);
      if (instanceSet && instanceSet.size > 0) return;
    }

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(this.sounds.get(name));
    sound.setVolume(volume);
    sound.setLoop(loop);
    sound.play();

    // 初始化该音效的实例集合
    if (!this.activeSounds.has(name)) {
      this.activeSounds.set(name, new Set());
    }
    const instanceSet = this.activeSounds.get(name);
    instanceSet.add(sound);

    // 播放结束后自动从集合中移除
    const cleanup = () => {
      instanceSet.delete(sound);
      if (instanceSet.size === 0) {
        this.activeSounds.delete(name);
      }
    };

    if (sound.source) {
      sound.source.onended = cleanup;
    }

    // 非循环音效才需要兜底清理
    if (!loop && sound.buffer) {
      setTimeout(cleanup, sound.buffer.duration * 1000 + 100);
    }
  }

  /**
   * 停止指定名称的所有音效实例
   * @param {string} name
   */
  stopSound(name) {
    const instanceSet = this.activeSounds.get(name);
    if (instanceSet) {
      instanceSet.forEach(sound => {
        if (sound.isPlaying) {
          sound.stop();
        }
      });
      this.activeSounds.delete(name);
    }
  }

  /**
   * 播放背景音乐 (循环)
   * @param {string} name
   * @param {number} volume
   */
  playBGM(name, volume = 0.2) {
    if (!this.listener || !this.sounds.has(name)) return;

    // 如果已经有 BGM 在播放，可以考虑先停止
    if (this.bgm) {
      this.bgm.stop();
    }

    this.bgm = new THREE.Audio(this.listener);
    this.bgm.setBuffer(this.sounds.get(name));
    this.bgm.setLoop(true);
    this.bgm.setVolume(volume);
    this.bgm.play();
  }
}

export const audioManager = new AudioManager();

/**
 * 异步初始化音频系统，预加载所有音效
 */
export async function initializeAudio() {
  const soundUrls = [
    './src/world/assets/sound/explosion.mp3',
    './src/world/assets/sound/put.mp3',
    './src/world/assets/sound/delete_get.mp3',
    './src/world/assets/sound/running_water.mp3',
    './src/world/assets/sound/running_land.mp3',
    './src/world/assets/sound/bgm.mp3'
  ];
  await audioManager.preloadSounds(soundUrls);
}
