import { z } from 'zod';

/**
 * Differential updates of JSON values (the match state pushed to the live clients): `diffJson` computes the
 * operations that turn one value into another, `applyPatch` applies them. Both are pure and deterministic.
 * Objects are compared key by key; arrays index by index, with `push` for new items and `trunc` for removed ones.
 * Applying `diffJson(a, b)` to `a` gives a value whose `JSON.stringify` is exactly the one of `b` (same key order).
 */

/** A value that survives `JSON.stringify`/`JSON.parse` unchanged. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Location inside a value: object keys are strings, array indexes are numbers; `[]` is the value itself. */
export type PatchPath = (string | number)[];

export type PatchOp =
  /** Replaces the value at `path` (an existing array index, a new or existing object key, or the root). */
  | { op: 'set'; path: PatchPath; value: JsonValue }
  /** Removes the object key at `path`. */
  | { op: 'del'; path: PatchPath }
  /** Appends `values` to the array at `path`. */
  | { op: 'push'; path: PatchPath; values: JsonValue[] }
  /** Shortens the array at `path` to `length` items. */
  | { op: 'trunc'; path: PatchPath; length: number };

/** Most levels of a patch path and most operations of one patch (a full state is far below both). */
export const PATCH_MAX_DEPTH = 64;
export const PATCH_MAX_OPS = 20_000;

const PathSchema = z.array(z.union([z.string().max(256), z.int().min(0)])).max(PATCH_MAX_DEPTH);
const JsonSchema = z.json() as z.ZodType<JsonValue>;

export const PatchOpSchema: z.ZodType<PatchOp> = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('set'), path: PathSchema, value: JsonSchema }),
  z.strictObject({ op: z.literal('del'), path: PathSchema.min(1) }),
  z.strictObject({ op: z.literal('push'), path: PathSchema, values: z.array(JsonSchema) }),
  z.strictObject({ op: z.literal('trunc'), path: PathSchema, length: z.int().min(0) }),
]);
export const PatchOpsSchema = z.array(PatchOpSchema).max(PATCH_MAX_OPS);

/** A patch that does not fit the value it is applied to. */
export class PatchError extends Error {
  readonly code = 'PATCH_INVALID';
}

type JsonObject = { [key: string]: JsonValue };

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pure: deep equality of two JSON values (object key order is ignored). */
export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i] as JsonValue, b[i] as JsonValue)) return false;
    return true;
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(b, key) || !jsonEqual(a[key] as JsonValue, b[key] as JsonValue)) return false;
    }
    return true;
  }
  return false;
}

/** True when the keys `b` keeps from `a` are in the same order and the new ones all come after them. */
function sameKeyOrder(aKeys: string[], a: JsonObject, bKeys: string[]): boolean {
  let next = 0;
  let added = false;
  for (const key of bKeys) {
    if (!Object.hasOwn(a, key)) {
      added = true;
      continue;
    }
    if (added) return false;
    while (next < aKeys.length && aKeys[next] !== key) next++;
    if (next === aKeys.length) return false;
    next++;
  }
  return true;
}

const opsSize = (ops: PatchOp[]): number => JSON.stringify(ops).length;

function diffInto(a: JsonValue, b: JsonValue, path: PatchPath, out: PatchOp[]): void {
  if (a === b) return;
  const child: PatchOp[] = [];
  if (Array.isArray(a) && Array.isArray(b)) {
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) diffInto(a[i] as JsonValue, b[i] as JsonValue, [...path, i], child);
    if (b.length < a.length) child.push({ op: 'trunc', path, length: b.length });
    if (b.length > a.length) child.push({ op: 'push', path, values: b.slice(a.length) });
  } else if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (!sameKeyOrder(aKeys, a, bKeys)) {
      out.push({ op: 'set', path, value: b });
      return;
    }
    for (const key of aKeys) if (!Object.hasOwn(b, key)) child.push({ op: 'del', path: [...path, key] });
    for (const key of bKeys) {
      const next = b[key] as JsonValue;
      if (Object.hasOwn(a, key)) diffInto(a[key] as JsonValue, next, [...path, key], child);
      else child.push({ op: 'set', path: [...path, key], value: next });
    }
  } else {
    if (!jsonEqual(a, b)) out.push({ op: 'set', path, value: b });
    return;
  }
  if (child.length === 0) return;
  // A container changed in many places is cheaper to send whole.
  const whole: PatchOp = { op: 'set', path, value: b };
  if (child.length > 1 && opsSize(child) > opsSize([whole])) out.push(whole);
  else out.push(...child);
}

/** Pure: operations that turn `a` into `b` (empty when they are equal). Both must be JSON values. */
export function diffJson(a: JsonValue, b: JsonValue): PatchOp[] {
  const out: PatchOp[] = [];
  diffInto(a, b, [], out);
  return out;
}

function fail(path: PatchPath, why: string): never {
  throw new PatchError(`patch non applicabile in /${path.join('/')}: ${why}`);
}

/**
 * Pure: `doc` with `ops` applied; `doc` is not changed and the parts the patch does not touch are shared with it.
 * Throws `PatchError` when an operation does not fit (missing key, index out of range, wrong type).
 */
export function applyPatch<T extends JsonValue>(doc: T, ops: readonly PatchOp[]): JsonValue {
  let root: JsonValue = doc;
  /** Containers created by this call: they can be changed in place. */
  const owned = new Set<object>();

  const own = (value: JsonValue, path: PatchPath): JsonObject | JsonValue[] => {
    if (typeof value !== 'object' || value === null) fail(path, 'non è un oggetto né un array');
    if (owned.has(value)) return value;
    const copy: JsonObject | JsonValue[] = Array.isArray(value) ? value.slice() : { ...value };
    owned.add(copy);
    return copy;
  };

  const read = (container: JsonObject | JsonValue[], key: string | number, path: PatchPath): JsonValue => {
    if (Array.isArray(container)) {
      if (typeof key !== 'number' || key >= container.length) fail(path, 'indice fuori dall’array');
      return container[key] as JsonValue;
    }
    if (typeof key !== 'string' || !Object.hasOwn(container, key)) fail(path, 'chiave mancante');
    return container[key] as JsonValue;
  };

  const write = (container: JsonObject | JsonValue[], key: string | number, value: JsonValue): void => {
    if (Array.isArray(container)) container[key as number] = value;
    // defineProperty: a key such as "__proto__" stays a plain own property.
    else Object.defineProperty(container, key, { value, writable: true, enumerable: true, configurable: true });
  };

  /** Owned container at `path` (copied along the way), replacing the originals in their parents. */
  const reach = (path: PatchPath): JsonObject | JsonValue[] => {
    let node = own(root, []);
    root = node;
    for (let i = 0; i < path.length; i++) {
      const key = path[i] as string | number;
      const at = path.slice(0, i + 1);
      const child = own(read(node, key, at), at);
      write(node, key, child);
      node = child;
    }
    return node;
  };

  for (const op of ops) {
    const { path } = op;
    if (op.op === 'set' || op.op === 'del') {
      if (path.length === 0) {
        if (op.op === 'del') fail(path, 'la radice non si cancella');
        root = op.value;
        continue;
      }
      const parent = reach(path.slice(0, -1));
      const key = path[path.length - 1] as string | number;
      if (Array.isArray(parent)) {
        if (op.op === 'del') fail(path, 'del su un array');
        read(parent, key, path);
        write(parent, key, op.value);
      } else {
        if (typeof key !== 'string') fail(path, 'chiave non testuale');
        if (op.op === 'set') write(parent, key, op.value);
        else if (Object.hasOwn(parent, key)) Reflect.deleteProperty(parent, key);
        else fail(path, 'chiave mancante');
      }
      continue;
    }
    const target = reach(path);
    if (!Array.isArray(target)) fail(path, 'non è un array');
    if (op.op === 'push') for (const value of op.values) target.push(value);
    else if (op.length > target.length) fail(path, 'lunghezza oltre l’array');
    else target.length = op.length;
  }
  return root;
}
