import { assert, assertEqual } from './assert.js';
import { makeCandidate, candidateKey } from '../workers/structure-index/StructureCandidateTypes.js';
import { collectLargeStaticCandidatesInRect } from '../workers/structure-index/LargeStaticCandidateCollector.js';
import { terrainGen } from '../world/TerrainGen.js';

export async function testStructureCandidateShape() {
  const c = makeCandidate('tank', 1.8, 2.2, -3.7, 'probabilistic_large_static');
  assertEqual(c.type, 'tank');
  assertEqual(c.x, 1);
  assertEqual(c.y, 2);
  assertEqual(c.z, -4);
  assertEqual(c.source, 'probabilistic_large_static');
}

export async function testCandidateKeyUniqueness() {
  const a = makeCandidate('tank', 10, 20, 30, 'probabilistic_large_static');
  const b = makeCandidate('tank', 10, 20, 30, 'probabilistic_large_static');
  const c = makeCandidate('tower', 10, 20, 30, 'probabilistic_large_static');

  assertEqual(candidateKey(a), candidateKey(b));
  assert(candidateKey(a) !== candidateKey(c), 'different type should produce different key');
}

export async function testLargeStaticCandidatesAreDeterministic() {
  const rect = { minX: -32, maxX: 96, minZ: -32, maxZ: 96 };
  const a = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  const b = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  assertEqual(JSON.stringify(a), JSON.stringify(b));
}
