import { lazy } from 'react';
import type { AppMode } from '../../../shared/modes';
import type { ModuleSnapshotV1 } from '../../../shared/modules/contracts';
import { STUDIO_WORKSPACE_VIEW_ID } from '../../../shared/modules/bundled-views';
import type { IconName } from '../../components/Icon';

export interface ModuleNavigationItem {
  id: AppMode;
  label: string;
  icon: IconName;
  tip: string;
}

/** Reviewed composition only. Manifest strings never become import paths. */
const bundledViews = [{
  viewId: STUDIO_WORKSPACE_VIEW_ID,
  moduleId: 'homebot.production-studio',
  id: 'media' as const,
  label: 'Studio',
  icon: 'video' as const,
  tip: 'Turn a script into a narrated video',
  Component: lazy(() => import('../../components/MediaStudioPanel')),
}];

export function registeredModuleViews(modules: ModuleSnapshotV1[]) {
  return bundledViews.filter(view => modules.some(module => module.manifest.id === view.moduleId &&
    module.state === 'enabled' && module.access === 'available' &&
    module.manifest.contributions.views.includes(view.viewId)));
}

export function isBundledModuleMode(mode: AppMode): boolean {
  return bundledViews.some(view => view.id === mode);
}
