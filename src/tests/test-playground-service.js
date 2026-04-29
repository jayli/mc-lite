import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { PlaygroundService } from '../services/PlaygroundService.js';
import { Chunk } from '../world/Chunk.js';

describe('PlaygroundService 测试', (test) => {
  test('detectExistingPlayground - 不应再从 persistence cache 回退检测创造台', () => {
    const originalPersistenceService = globalThis._persistenceService;
    globalThis._persistenceService = {
      cache: new Map([
        ['0,0', {
          blocks: {
            [Chunk.encodeCoord(10, 5, 10)]: { type: 'playground_center_block', orientation: 0 }
          },
          entities: {}
        }]
      ])
    };

    PlaygroundService.instance = null;
    const service = PlaygroundService.getInstance();
    service.world = { chunks: new Map() };
    service.playgroundOrigin = null;
    service.playgroundBlocks.clear();
    service.isPlaygroundActive = false;

    const found = service.detectExistingPlayground();

    assertEqual(found, false, '不应再从旧 persistence cache 检测创造台');
    assertEqual(service.isPlaygroundActive, false, '旧 persistence cache 不应激活创造台');
    assertTrue(service.playgroundOrigin === null, '旧 persistence cache 不应写入创造台原点');

    PlaygroundService.instance = null;
    if (originalPersistenceService === undefined) delete globalThis._persistenceService;
    else globalThis._persistenceService = originalPersistenceService;
  });
});
