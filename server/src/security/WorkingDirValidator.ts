import { realpathSync, existsSync } from 'fs';
import path from 'path';

export interface ValidationResult {
  allowed: boolean;
  error?: string;
  resolvedPath?: string;
}

/**
 * Validates that a workingDir is within an allowlist of directories.
 * Resolves symlinks and prevents path traversal attacks.
 */
export class WorkingDirValidator {
  private allowedDirs: string[] = [];

  constructor(allowedDirs: string[]) {
    this.setAllowedDirs(allowedDirs);
  }

  /**
   * Validate a working directory against the allowlist.
   */
  validate(workingDir: string): ValidationResult {
    // Input validation
    if (!workingDir || typeof workingDir !== 'string') {
      return { allowed: false, error: 'Working directory is required and must be a string' };
    }

    // Empty allowlist → deny all
    if (this.allowedDirs.length === 0) {
      return {
        allowed: false,
        error: 'No allowed working directories configured. Configure via the admin UI.',
      };
    }

    // Resolve the path: use realpathSync if the path exists (follows symlinks),
    // otherwise use path.resolve (for dirs that don't exist yet)
    let resolvedPath: string;
    if (existsSync(workingDir)) {
      resolvedPath = realpathSync(workingDir);
    } else {
      // For non-existent paths, resolve as much as we can.
      // Walk up to find the deepest existing ancestor and resolve from there.
      resolvedPath = this._resolveNonExistent(workingDir);
    }

    // Check if resolved path is within any allowed directory
    for (const allowedDir of this.allowedDirs) {
      if (resolvedPath === allowedDir || resolvedPath.startsWith(allowedDir + path.sep)) {
        return { allowed: true, resolvedPath };
      }
    }

    return {
      allowed: false,
      error: `Path "${workingDir}" is not within any allowed directory`,
    };
  }

  /**
   * Hot-reload: update the allowlist.
   */
  setAllowedDirs(dirs: string[]): void {
    this.allowedDirs = dirs.map((dir) => {
      // Resolve each allowed dir to its real path (follows symlinks)
      if (existsSync(dir)) {
        return realpathSync(dir);
      }
      return path.resolve(dir);
    });
  }

  /**
   * Get the current allowlist (resolved paths).
   */
  getAllowedDirs(): string[] {
    return [...this.allowedDirs];
  }

  /**
   * Resolve a non-existent path by walking up to find the deepest
   * existing ancestor and resolving the remainder relative to it.
   */
  private _resolveNonExistent(inputPath: string): string {
    const absolute = path.resolve(inputPath);
    let current = absolute;
    const suffixes: string[] = [];

    // Walk up until we find a directory that exists
    while (!existsSync(current) && current !== path.dirname(current)) {
      suffixes.unshift(path.basename(current));
      current = path.dirname(current);
    }

    // Resolve the existing ancestor (follows symlinks)
    const resolvedBase = existsSync(current) ? realpathSync(current) : current;
    return path.join(resolvedBase, ...suffixes);
  }
}
