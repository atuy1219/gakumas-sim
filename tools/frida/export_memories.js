'use strict';

/*
 * Export UserMemory records as one JSON object per line.
 * Usage:
 *   frida -U -N com.bandainamcoent.idolmaster_gakuen \
 *     -l tools/frida/export_memories.js -o memories.log
 */

const LIB_NAME = 'libil2cpp.so';
const TARGET_NAMESPACE = 'Campus.Common.Proto.Client.Transaction';
const TARGET_CLASS = 'UserMemory';
const OUTPUT_PREFIX = 'GAKUMAS_MEMORY ';
const exportedSnapshots = new Map();
let installed = false;

function api(module, name, ret, args) {
  return new NativeFunction(module.getExportByName(name), ret, args);
}

function readIl2CppString(value) {
  if (!value || value.isNull()) return '';
  const lengthOffset = Process.pointerSize * 2;
  const length = value.add(lengthOffset).readS32();
  if (length < 0 || length > 16 * 1024 * 1024) throw new Error(`invalid Il2CppString length: ${length}`);
  return value.add(lengthOffset + 4).readUtf16String(length);
}

function findClass(module) {
  const domainGet = api(module, 'il2cpp_domain_get', 'pointer', []);
  const domainGetAssemblies = api(module, 'il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']);
  const assemblyGetImage = api(module, 'il2cpp_assembly_get_image', 'pointer', ['pointer']);
  const imageGetName = api(module, 'il2cpp_image_get_name', 'pointer', ['pointer']);
  const classFromName = api(module, 'il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']);

  const countPtr = Memory.alloc(Process.pointerSize);
  countPtr.writeU64(0);
  const assemblies = domainGetAssemblies(domainGet(), countPtr);
  const count = Number(countPtr.readU64());
  const namespacePtr = Memory.allocUtf8String(TARGET_NAMESPACE);
  const classPtr = Memory.allocUtf8String(TARGET_CLASS);

  for (let i = 0; i < count; i += 1) {
    const assembly = assemblies.add(i * Process.pointerSize).readPointer();
    const image = assemblyGetImage(assembly);
    if (image.isNull()) continue;
    const namePtr = imageGetName(image);
    const imageName = namePtr.isNull() ? '' : namePtr.readUtf8String();
    const klass = classFromName(image, namespacePtr, classPtr);
    if (!klass.isNull()) return { klass, imageName };
  }
  return null;
}

function findMethod(module, klass, predicate) {
  const classGetMethods = api(module, 'il2cpp_class_get_methods', 'pointer', ['pointer', 'pointer']);
  const methodGetName = api(module, 'il2cpp_method_get_name', 'pointer', ['pointer']);
  const methodGetParamCount = api(module, 'il2cpp_method_get_param_count', 'uint32', ['pointer']);
  const iter = Memory.alloc(Process.pointerSize);
  iter.writePointer(ptr(0));

  while (true) {
    const method = classGetMethods(klass, iter);
    if (method.isNull()) return null;
    const namePtr = methodGetName(method);
    const name = namePtr.isNull() ? '' : namePtr.readUtf8String();
    const parameterCount = methodGetParamCount(method);
    if (predicate(name, parameterCount)) return method;
  }
}

function methodPointer(methodInfo) {
  // MethodInfo starts with methodPointer for non-inflated IL2CPP methods.
  const pointer = methodInfo.readPointer();
  if (pointer.isNull()) throw new Error('method pointer is null');
  return pointer;
}

function install() {
  if (installed) return true;
  let module;
  try {
    module = Process.getModuleByName(LIB_NAME);
  } catch {
    return false;
  }

  const target = findClass(module);
  if (!target) throw new Error(`${TARGET_NAMESPACE}.${TARGET_CLASS} not found`);

  const toStringInfo = findMethod(module, target.klass, (name, count) => name === 'ToString' && count === 0);
  const mergeInfo = findMethod(module, target.klass, (name, count) => name.endsWith('InternalMergeFrom') && count === 1);
  if (!toStringInfo || !mergeInfo) throw new Error('required UserMemory methods not found');

  const toString = new NativeFunction(methodPointer(toStringInfo), 'pointer', ['pointer', 'pointer']);
  const mergeAddress = methodPointer(mergeInfo);

  Interceptor.attach(mergeAddress, {
    onEnter(args) {
      this.memory = args[0];
    },
    onLeave() {
      try {
        if (!this.memory || this.memory.isNull()) return;
        const managed = toString(this.memory, toStringInfo);
        const jsonText = readIl2CppString(managed);
        const memory = JSON.parse(jsonText);
        const userMemoryId = String(memory.userMemoryId ?? '');
        if (!userMemoryId) return;
        const snapshot = JSON.stringify(memory);
        if (exportedSnapshots.get(userMemoryId) === snapshot) return;
        exportedSnapshots.set(userMemoryId, snapshot);
        // InternalMergeFrom は同じオブジェクトを複数回更新する。後続の完全な
        // スナップショットも出力し、Web 側で最も情報量の多いものを採用する。
        console.log(OUTPUT_PREFIX + snapshot);
      } catch (error) {
        console.error('[memory-export] ' + error);
      }
    },
  });

  installed = true;
  console.log(`[memory-export] ready: ${target.imageName}`);
  return true;
}

const timer = setInterval(() => {
  try {
    if (install()) clearInterval(timer);
  } catch (error) {
    clearInterval(timer);
    console.error('[memory-export] setup failed: ' + error);
  }
}, 250);
