import type { ModelConfigRecord } from '../api/client';

function isUsableModel(model: ModelConfigRecord): boolean {
  return model.enabled;
}

export function isMockModel(model: ModelConfigRecord): boolean {
  return model.provider === 'mock';
}

function isOllamaModel(model: ModelConfigRecord): boolean {
  return model.provider === 'ollama';
}

function isOpenRouterFreeModel(model: ModelConfigRecord): boolean {
  return model.provider === 'openrouter' && model.modelName.trim().toLowerCase().endsWith(':free');
}

function pickRealFallbackModel(models: ModelConfigRecord[]): ModelConfigRecord | undefined {
  const realDefault = models.find((model) => model.isDefault);
  if (realDefault) {
    return realDefault;
  }

  const dedicatedHostedModels = models.filter(
    (model) => !isOllamaModel(model) && !isOpenRouterFreeModel(model),
  );
  if (dedicatedHostedModels.length > 0) {
    return dedicatedHostedModels[0];
  }

  const hostedFallbackModels = models.filter((model) => !isOllamaModel(model));
  if (hostedFallbackModels.length > 0) {
    return hostedFallbackModels[0];
  }

  return models[0];
}

export function hasEnabledRealModels(models: ModelConfigRecord[], excludeModelId?: string): boolean {
  return models.some((model) => isUsableModel(model) && !isMockModel(model) && model.modelId !== excludeModelId);
}

export function pickPreferredModel(models: ModelConfigRecord[], selectedModelId?: string): ModelConfigRecord | undefined {
  const enabledModels = models.filter(isUsableModel);
  const explicitlySelected = enabledModels.find((model) => model.modelId === selectedModelId);
  if (explicitlySelected) {
    return explicitlySelected;
  }

  const realModels = enabledModels.filter((model) => !isMockModel(model));
  if (realModels.length > 0) {
    return pickRealFallbackModel(realModels);
  }

  return enabledModels.find((model) => model.isDefault) ?? enabledModels[0];
}

export function pickPreferredModelId(models: ModelConfigRecord[], selectedModelId?: string): string {
  return pickPreferredModel(models, selectedModelId)?.modelId ?? '';
}