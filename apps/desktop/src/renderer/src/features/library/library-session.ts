import type { AppRoute } from '../../app/routes';
import { DEFAULT_LIBRARY_SESSION_STATE, type LibrarySessionViewState } from './library-model';

interface LibraryNavigationOrigin {
  route: Extract<AppRoute, { area: 'library' }>;
  scrollTop: number;
  focusId: string;
}

let viewState: LibrarySessionViewState = { ...DEFAULT_LIBRARY_SESSION_STATE };
let navigationOrigins: LibraryNavigationOrigin[] = [];

export function readLibrarySession(): LibrarySessionViewState {
  return { ...viewState };
}

export function writeLibrarySession(next: LibrarySessionViewState): void {
  viewState = { ...next };
}

export function rememberLibraryOrigin(origin: LibraryNavigationOrigin): void {
  navigationOrigins.push(origin);
}

export function consumeLibraryOrigin(): LibraryNavigationOrigin | null {
  return navigationOrigins.pop() ?? null;
}

export function peekLibraryOrigin(): LibraryNavigationOrigin | null {
  return navigationOrigins.at(-1) ?? null;
}

export function clearLibraryOrigins(): void {
  navigationOrigins = [];
}

export function resetLibrarySessionForTests(): void {
  viewState = { ...DEFAULT_LIBRARY_SESSION_STATE };
  navigationOrigins = [];
}
