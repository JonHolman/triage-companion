import {
  type ConfigFieldModel,
  type ResolutionContext,
  type ResolvedFieldState,
  type ServiceId,
  type ServiceResolution,
} from "./config-model-core.ts";
import { getServiceDefinition } from "./config-model-services.ts";

export * from "./config-model-core.ts";
export {
  getServiceDefinition,
  getServiceSetting,
  listServiceDefinitions,
} from "./config-model-services.ts";
export {
  atlassianCloudID,
  hasUnsafeURLPathSegments,
  normalizeSnykAPIBaseURL,
  parseJSONStringArray,
  usSnykAPIBaseURL,
  validateGitHubIgnoredBranchNames,
  validateGitSearchRootEntries,
  validateRegularExpression,
} from "./config-model-validators.ts";

function trim(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveValue(field: ConfigFieldModel, context: ResolutionContext): ResolvedFieldState {
  const envVar = field.envVar;
  const environmentOverridesStored = Boolean(
    envVar && (!field.secret || field.environmentOverridesStored),
  );
  const readEnvValue = (): string | undefined => {
    if (!envVar) {
      return undefined;
    }

    const envValue = context.readEnv(envVar);
    if (!field.ignoreBlankEnvironmentValue) {
      return envValue;
    }

    return trim(envValue) === null ? undefined : envValue;
  };

  if (environmentOverridesStored && envVar) {
    const envValue = readEnvValue();
    if (envValue !== undefined) {
      return { value: envValue, source: "environment" };
    }
  }

  if (field.storage) {
    const stored = context.readSecret(field.storage.service, field.storage.account);
    if (stored !== null) {
      return { value: stored, source: "secret" };
    }
  }

  if (envVar && !environmentOverridesStored) {
    const envValue = readEnvValue();
    if (envValue !== undefined) {
      return { value: envValue, source: "environment" };
    }
  }

  if (field.defaultValues?.length) {
    return {
      value: field.defaultValues.join(", "),
      source: "default",
    };
  }

  return { value: null, source: "missing" };
}

export function resolveServiceState(
  serviceId: ServiceId,
  context: ResolutionContext,
): ServiceResolution {
  const definition = getServiceDefinition(serviceId);
  const values: Record<string, ResolvedFieldState> = {};
  const errors: string[] = [];

  const evaluate = (field: ConfigFieldModel): void => {
    const state = resolveValue(field, context);
    values[field.key] = state;

    if (field.required && state.value === null) {
      errors.push(`${field.label} is required for ${definition.name}.`);
      return;
    }

    if (state.value !== null && state.source !== "default" && field.validate) {
      const validation = field.validate(state.value);
      if (validation !== null) {
        errors.push(`${field.label} is invalid: ${validation}`);
      }
    }
  };

  for (const field of definition.requiredSettings) {
    evaluate(field);
  }

  for (const field of definition.optionalSettings) {
    evaluate(field);
  }

  return {
    configured: errors.length === 0,
    values,
    errors,
  };
}
