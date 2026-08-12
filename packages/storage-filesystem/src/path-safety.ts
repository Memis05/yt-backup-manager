import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
  'COM\u00b9',
  'COM\u00b2',
  'COM\u00b3',
  'LPT\u00b9',
  'LPT\u00b2',
  'LPT\u00b3',
]);

function nodeErrorCode(error: unknown): string | null {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

function relationshipEscapesRoot(rootPath: string, candidatePath: string): boolean {
  const relationship = relative(rootPath, candidatePath);
  return relationship === '..' || relationship.startsWith(`..${sep}`) || isAbsolute(relationship);
}

function truncateUtf16(value: string, maximumCodeUnits: number): string {
  let truncated = value.slice(0, maximumCodeUnits);
  const last = truncated.charCodeAt(truncated.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) truncated = truncated.slice(0, -1);
  return truncated;
}

export function sanitizeWindowsComponent(value: string, maximumLength = 120): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  const safeBase =
    normalized === '' || normalized === '.' || normalized === '..' ? 'Untitled' : normalized;
  const stem = safeBase.split('.')[0]?.trimEnd().toUpperCase() ?? '';
  const protectedName = WINDOWS_RESERVED_NAMES.has(stem) ? `_${safeBase}` : safeBase;
  return truncateUtf16(protectedName, maximumLength).replace(/[. ]+$/g, '') || 'Untitled';
}

export function sanitizeProviderId(value: string): string {
  const safe = value.normalize('NFC').replace(/[^A-Za-z0-9_-]/g, '_');
  return safe.slice(0, 128) || 'unknown-id';
}

export function archiveFolderName(title: string, providerId: string, maximumLength = 180): string {
  const safeId = sanitizeProviderId(providerId);
  const suffix = ` [${safeId}]`;
  const titleBudget = Math.max(1, maximumLength - suffix.length);
  return `${sanitizeWindowsComponent(title, titleBudget)}${suffix}`;
}

export function channelRelativeDirectory(channelTitle: string, providerChannelId: string): string {
  return archiveFolderName(channelTitle, providerChannelId);
}

export function mediaRelativeDirectory(
  mediaType: 'VIDEO' | 'SHORT' | 'LIVE',
  title: string,
  providerMediaId: string,
): string {
  const category = mediaType === 'SHORT' ? 'Shorts' : mediaType === 'LIVE' ? 'Live' : 'Videos';
  return `${category}${sep}${archiveFolderName(title, providerMediaId)}`;
}

export function resolvePathUnderRoot(rootPath: string, relativePath: string): string {
  if (relativePath.trim() === '' || isAbsolute(relativePath)) {
    throw new Error('Backup relative path must be non-empty and relative');
  }
  const root = resolve(rootPath);
  const target = resolve(root, relativePath);
  const relationship = relative(root, target);
  if (
    relationship === '' ||
    relationship === '..' ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error('Backup path escapes the configured destination root');
  }
  return target;
}

export interface PhysicalPathConfinementOptions {
  allowMissing?: boolean;
  allowRoot?: boolean;
}

/**
 * Rejects symbolic links and Windows junctions in every existing component and
 * verifies that real paths stay below the configured root. Call it again after
 * creating previously missing directories to close the ordinary mkdir race.
 */
export async function assertPathPhysicallyUnderRoot(
  rootPath: string,
  candidatePath: string,
  options: PhysicalPathConfinementOptions = {},
): Promise<string> {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const lexicalRelationship = relative(root, candidate);
  if (
    (!options.allowRoot && lexicalRelationship === '') ||
    relationshipEscapesRoot(root, candidate)
  ) {
    throw new Error('Backup path escapes the configured filesystem root');
  }

  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Configured filesystem root must be a physical directory');
  }
  const physicalRoot = resolve(await realpath(root));
  let current = root;
  const components = lexicalRelationship === '' ? [] : lexicalRelationship.split(sep);
  for (const component of components) {
    current = join(current, component);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(current);
    } catch (error) {
      if (options.allowMissing && nodeErrorCode(error) === 'ENOENT') return candidate;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error('Backup path contains a symbolic link, junction, or reparse point');
    }
    const physicalCurrent = resolve(await realpath(current));
    if (relationshipEscapesRoot(physicalRoot, physicalCurrent)) {
      throw new Error('Backup path escapes the configured filesystem root through a reparse point');
    }
  }
  return candidate;
}
