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
   */
  playSound(name, volume = 0.4) {
    if (!this.listener || !this.sounds.has(name)) return;

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(this.sounds.get(name));
    sound.setVolume(volume);
    sound.play();
  }
}

export const audioManager = new AudioManager();

/**
 * 异步初始化音频系统，预加载所有音效
 */
export async function initializeAudio() {
  const soundUrls = [
    './src/world/assets/sound/explosion.mp3'
  ];
  await audioManager.preloadSounds(soundUrls);
}
