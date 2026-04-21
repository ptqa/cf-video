import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

export async function handleLibraries(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  switch (endpoint) {
    case 'Library/MediaFolders': {
      const libraries = await queries.getLibraries(env.DB);
      return jellyfinSuccess({
        Items: libraries.map(lib => ({
          Id: lib.id,
          Name: lib.name,
          CollectionType: lib.type,
          Path: lib.path_prefix,
          LibraryOptions: {
            EnablePhotos: true,
            EnableRealtimeMonitor: false,
            EnableChapterImageExtraction: false,
            ExtractChapterImagesDuringLibraryScan: false,
            PathInfos: [{ Path: lib.path_prefix }],
          },
        })),
        TotalRecordCount: libraries.length,
      });
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}