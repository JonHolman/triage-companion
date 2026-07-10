import { Command } from "commander";

import * as github from "../clients/github.ts";
import * as git from "../clients/git.ts";
import * as snyk from "../clients/snyk.ts";
import * as jira from "../clients/jira.ts";
import { configFilePath, read as readCredential } from "../credential-store.ts";
import { bold, dim } from "../format.ts";
import { listServiceDefinitions, resolveServiceState, type TokenPermissionRequirement } from "../config-model.ts";
import { type ServiceId } from "../config-model.ts";
import { inlineErrorText, runCommand } from "./command-utils.ts";

export interface StatusDependencies {
  hasGitHubToken: () => boolean;
  hasSnykToken: () => boolean;
  hasJiraCredentials: () => boolean;
  gitBinary: () => string | null;
  credentialsPath: () => string;
  validationErrors?: (serviceId: ServiceId) => string[];
}

export interface ServiceStatus {
  name: string;
  configured: boolean;
  hint: string;
  env: string;
  availableLabel?: string;
  missingLabel?: string;
  permissionRequirements: readonly TokenPermissionRequirement[];
  errors: string[];
}

function defaultDependencies(): StatusDependencies {
  return {
    hasGitHubToken: () => github.hasToken(),
    hasSnykToken: () => snyk.hasToken(),
    hasJiraCredentials: () => jira.hasCredentials(),
    gitBinary: () => git.resolveGitBinary(),
    credentialsPath: () => configFilePath(),
    validationErrors: (serviceId) =>
      resolveServiceState(serviceId, {
        readEnv: (name) => process.env[name],
        readSecret: (serviceName, account) => readCredential(serviceName, account),
      }).errors,
  };
}

function isConfigured(serviceId: ServiceId, deps: StatusDependencies): boolean {
  if (serviceId === "git") {
    return deps.gitBinary() !== null;
  }

  if (serviceId === "github") {
    return deps.hasGitHubToken();
  }

  if (serviceId === "snyk") {
    return deps.hasSnykToken();
  }

  return deps.hasJiraCredentials();
}

function validationErrorsFor(serviceId: ServiceId, deps: StatusDependencies): string[] {
  try {
    return deps.validationErrors?.(serviceId) ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [inlineErrorText(message)];
  }
}

function localGitValidationErrors(deps: StatusDependencies): string[] {
  return validationErrorsFor("local", deps).filter((error) => error.startsWith("Git search roots "));
}

function buildStatusItems(deps: StatusDependencies): ServiceStatus[] {
  const services = listServiceDefinitions().filter((service) => service.id !== "local");

  return services.map((service) => {
    const errors = [
      ...validationErrorsFor(service.id, deps),
      ...(service.id === "git" ? localGitValidationErrors(deps) : []),
    ];
    const configured = errors.length === 0 && isConfigured(service.id, deps);

    return {
      name: service.name,
      configured,
      hint: service.status.saveHint,
      env: service.status.envHint,
      availableLabel: service.id === "git" ? service.status.configuredLabel : undefined,
      missingLabel: service.id === "git" ? service.status.missingLabel : undefined,
      permissionRequirements: service.status.permissionRequirements,
      errors,
    };
  });
}

export function buildStatusReport(deps: StatusDependencies = defaultDependencies()): string {
  const services = buildStatusItems(deps);
  const lines: string[] = [bold("Service Status\n")];

  for (const service of services) {
    const icon = service.configured ? "✓" : "✗";
    const status = service.configured
      ? (service.availableLabel ?? "configured")
      : (service.missingLabel ?? "not configured");

    lines.push(`  ${icon} ${bold(service.name)}: ${status}`);
    if (!service.configured) {
      lines.push(dim(`    Set up: ${service.hint}`));
      lines.push(dim(`    Or env: ${service.env}`));
      if (service.permissionRequirements.length > 0) {
        lines.push(dim("    Permissions needed:"));
        for (const requirement of service.permissionRequirements) {
          lines.push(dim(`      ${requirement.feature}: ${requirement.permissions.join(", ")}`));
        }
      }
      if (service.errors.length > 0) {
        lines.push(dim("    Configuration errors:"));
        for (const error of service.errors) {
          lines.push(dim(`      ${inlineErrorText(error)}`));
        }
      }
    }
  }

  try {
    lines.push(dim(`\nCredentials are stored in ${deps.credentialsPath()}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(dim(`\nCredentials file unavailable: ${inlineErrorText(message)}`));
  }
  return `${lines.join("\n")}\n`;
}

export function register(program: Command, deps: StatusDependencies = defaultDependencies()): void {
  program
    .command("status")
    .description("Show configuration and availability status for all services")
    .action(() => {
      return runCommand("status", () => {
        process.stdout.write(buildStatusReport(deps));
      });
    });
}
