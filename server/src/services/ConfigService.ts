import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './HeartbeatService.js';

/**
 * Field schema for validation
 */
interface FieldSchema {
  type: 'boolean' | 'number' | 'string' | 'array';
  min?: number;
  max?: number;
  /** For array type: the expected type of each item */
  itemType?: 'string' | 'number' | 'boolean';
  /** For string type: allowed values */
  enum?: string[];
}

/**
 * Section definition with field schemas
 */
interface SectionDefinition {
  fields: Record<string, FieldSchema>;
}

/**
 * Allowlist of editable config sections.
 * Add new sections here to make them available in the admin UI.
 */
const EDITABLE_SECTIONS: Record<string, SectionDefinition> = {
  heartbeat: {
    fields: {
      enabled: { type: 'boolean' },
      intervalMs: { type: 'number', min: 60000 },  // minimum 1 minute
      workingDirectory: { type: 'string' },
      maxItems: { type: 'number', min: 0 },
      maxRuns: { type: 'number', min: 0 },
    },
  },
  security: {
    fields: {
      allowedWorkingDirs: { type: 'array', itemType: 'string' },
    },
  },
  logging: {
    fields: {
      requestLogLevel: { type: 'string', enum: ['off', 'errors-only', 'all'] },
    },
  },
};

/**
 * ConfigService provides centralized read/write access to config.json,
 * with allowlist-based validation to protect sensitive keys.
 */
export class ConfigService {
  private configDir: string;

  constructor(configDir?: string) {
    this.configDir = configDir || getConfigDir();
  }

  /**
   * Get the path to config.json
   */
  private getConfigPath(): string {
    return join(this.configDir, 'config.json');
  }

  /**
   * Read the full config.json from disk
   */
  private readConfig(): Record<string, unknown> {
    const configPath = this.getConfigPath();
    if (!existsSync(configPath)) {
      return {};
    }
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  /**
   * Write the full config.json to disk (preserves all keys)
   */
  private writeConfig(config: Record<string, unknown>): void {
    mkdirSync(this.configDir, { recursive: true });
    writeFileSync(this.getConfigPath(), JSON.stringify(config, null, 2));
  }

  /**
   * Get the names of all editable sections
   */
  getEditableSectionNames(): string[] {
    return Object.keys(EDITABLE_SECTIONS);
  }

  /**
   * Get all editable sections with their current values
   */
  getAllEditableSections(): Record<string, unknown> {
    const config = this.readConfig();
    const result: Record<string, unknown> = {};
    for (const name of Object.keys(EDITABLE_SECTIONS)) {
      result[name] = config[name] ?? {};
    }
    return result;
  }

  /**
   * Get a single editable section by name
   */
  getSection(name: string): Record<string, unknown> | null {
    if (!EDITABLE_SECTIONS[name]) {
      return null;
    }
    const config = this.readConfig();
    return (config[name] as Record<string, unknown>) ?? {};
  }

  /**
   * Validate and update a single section.
   * Uses read-modify-write to preserve all other keys in config.json.
   * Returns null on success, or an error message string on failure.
   */
  updateSection(name: string, data: Record<string, unknown>): string | null {
    const sectionDef = EDITABLE_SECTIONS[name];
    if (!sectionDef) {
      return `Unknown section: ${name}`;
    }

    // Validate each field
    for (const [key, value] of Object.entries(data)) {
      const fieldDef = sectionDef.fields[key];
      if (!fieldDef) {
        return `Unknown field: ${key}`;
      }

      // Array type check
      if (fieldDef.type === 'array') {
        if (!Array.isArray(value)) {
          return `Field "${key}" must be an array`;
        }
        if (fieldDef.itemType) {
          for (const item of value) {
            if (typeof item !== fieldDef.itemType) {
              return `Field "${key}" must contain only ${fieldDef.itemType} items`;
            }
          }
        }
        continue;
      }

      // Type check
      if (typeof value !== fieldDef.type) {
        return `Field "${key}" must be of type ${fieldDef.type}, got ${typeof value}`;
      }

      // Enum check for strings
      if (fieldDef.type === 'string' && fieldDef.enum && typeof value === 'string') {
        if (!fieldDef.enum.includes(value)) {
          return `Field "${key}" must be one of: ${fieldDef.enum.join(', ')}`;
        }
      }

      // Range checks for numbers
      if (fieldDef.type === 'number' && typeof value === 'number') {
        if (fieldDef.min !== undefined && value < fieldDef.min) {
          return `Field "${key}" must be >= ${fieldDef.min}`;
        }
        if (fieldDef.max !== undefined && value > fieldDef.max) {
          return `Field "${key}" must be <= ${fieldDef.max}`;
        }
      }
    }

    // Read-modify-write
    const config = this.readConfig();
    const existing = (config[name] as Record<string, unknown>) ?? {};
    config[name] = { ...existing, ...data };
    this.writeConfig(config);

    return null;
  }
}
