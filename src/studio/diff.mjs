import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Workspace File Tree & Visual Diff Engine.
 * Provides hierarchical file trees and unified diffs across session revisions.
 */
export class WorkspaceDiffEngine {
  constructor(workspaceRoot) {
    this.root = resolve(workspaceRoot);
  }

  scanTree(dir = this.root) {
    if (!existsSync(dir)) return [];
    const entries = [];
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const fullPath = join(dir, name);
      try {
        const stat = statSync(fullPath);
        const rel = relative(this.root, fullPath).replace(/\\/g, '/');
        if (stat.isDirectory()) {
          entries.push({
            name,
            path: rel,
            type: 'directory',
            children: this.scanTree(fullPath),
          });
        } else {
          entries.push({
            name,
            path: rel,
            type: 'file',
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
        }
      } catch {
        // Skip inaccessible entries
      }
    }
    return entries;
  }

  readFileContent(relPath) {
    const fullPath = resolve(this.root, relPath);
    if (!fullPath.startsWith(this.root)) {
      throw new Error('Access denied: path traversal detected');
    }
    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
      return null;
    }
    return readFileSync(fullPath, 'utf8');
  }

  takeSnapshot() {
    const files = {};
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.size < 500000) {
          // Store text snapshot for diffing (<500kb)
          const rel = relative(this.root, full).replace(/\\/g, '/');
          try {
            files[rel] = readFileSync(full, 'utf8');
          } catch {
            // ignore binary/unreadable
          }
        }
      }
    };
    walk(this.root);
    return files;
  }

  computeDiff(oldSnapshot = {}, newSnapshot = {}) {
    const diffs = [];
    const allFiles = new Set([...Object.keys(oldSnapshot), ...Object.keys(newSnapshot)]);

    for (const file of allFiles) {
      const oldText = oldSnapshot[file];
      const newText = newSnapshot[file];

      if (oldText === undefined) {
        // Created
        const lines = (newText || '').split('\n');
        diffs.push({
          file,
          type: 'created',
          additions: lines.length,
          deletions: 0,
          patch: lines.map((l) => `+ ${l}`).join('\n'),
        });
      } else if (newText === undefined) {
        // Deleted
        const lines = (oldText || '').split('\n');
        diffs.push({
          file,
          type: 'deleted',
          additions: 0,
          deletions: lines.length,
          patch: lines.map((l) => `- ${l}`).join('\n'),
        });
      } else if (oldText !== newText) {
        // Modified
        const patchLines = [];
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');
        let additions = 0;
        let deletions = 0;

        const max = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < max; i++) {
          if (oldLines[i] !== newLines[i]) {
            if (oldLines[i] !== undefined) {
              patchLines.push(`- ${oldLines[i]}`);
              deletions++;
            }
            if (newLines[i] !== undefined) {
              patchLines.push(`+ ${newLines[i]}`);
              additions++;
            }
          }
        }

        diffs.push({
          file,
          type: 'modified',
          additions,
          deletions,
          patch: patchLines.slice(0, 300).join('\n'),
        });
      }
    }

    return diffs;
  }
}
