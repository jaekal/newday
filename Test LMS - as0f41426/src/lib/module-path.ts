export type ModulePathItem = {
  id: string;
  prerequisiteModuleId?: string | null;
  completions: Array<unknown>;
};

export function isModuleUnlocked(
  module: Pick<ModulePathItem, "prerequisiteModuleId">,
  completedModuleIds: Set<string>,
) {
  if (!module.prerequisiteModuleId) return true;
  return completedModuleIds.has(module.prerequisiteModuleId);
}

export function getCompletedModuleIds(modules: Array<Pick<ModulePathItem, "id" | "completions">>) {
  return new Set(
    modules
      .filter((module) => module.completions.length > 0)
      .map((module) => module.id),
  );
}

export function getNextAvailableModuleId<T extends ModulePathItem>(modules: T[]) {
  const completedModuleIds = getCompletedModuleIds(modules);
  return modules.find(
    (module) =>
      module.completions.length === 0 &&
      isModuleUnlocked(module, completedModuleIds),
  )?.id;
}
