// The nav graph: bots walk node to node along NAV_EDGES, shortest path by breadth-first
// search. One shared adjacency list, no allocation in the hot path beyond the path array.
import { NAV_NODES, NAV_EDGES } from './world.js';

const adjacency = new Map();
for (const name of Object.keys(NAV_NODES)) adjacency.set(name, []);
for (const [a, b] of NAV_EDGES) {
  adjacency.get(a).push(b);
  adjacency.get(b).push(a);
}

function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const name of Object.keys(NAV_NODES)) {
    const node = NAV_NODES[name];
    const dx = node[0] - x;
    const dz = node[1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

// Breadth-first search from the node nearest (x, z) to the node nearest (tx, tz).
// Returns an array of [x, z] waypoints, first the target node, last the start's neighbour.
export function findPath(x, z, tx, tz) {
  const start = nearestNode(x, z);
  const goal = nearestNode(tx, tz);
  if (start === goal) return [[tx, tz]];
  const prev = new Map([[start, null]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === goal) break;
    for (const next of adjacency.get(current)) {
      if (!prev.has(next)) {
        prev.set(next, current);
        queue.push(next);
      }
    }
  }
  if (!prev.has(goal)) return [[tx, tz]];
  const nodes = [];
  let cursor = goal;
  while (cursor !== null) {
    nodes.push(cursor);
    cursor = prev.get(cursor);
  }
  nodes.reverse();
  // Drop the first node (where the bot already stands) and turn the rest into points.
  const points = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const node = NAV_NODES[nodes[i]];
    points.push([node[0], node[1]]);
  }
  points.push([tx, tz]);
  return points;
}

export function nodePosition(name) {
  const node = NAV_NODES[name];
  return { x: node[0], z: node[1] };
}
