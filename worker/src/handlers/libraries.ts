import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

// Static library IDs
const MOVIES_LIBRARY_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const TV_LIBRARY_ID = 'a656b907eb3a73532e40e44b968d0225';
const SERVER_ID = 'cf01de0000000000000000000000cafe';

/**
 * Format a library view as a BaseItemDto with Type=CollectionFolder.
 */
function formatLibraryView(
  name: string,
  id: string,
  collectionType: string,
  childCount: number
): Record<string, unknown> {
  return {
    Name: name,
    ServerId: SERVER_ID,
    Id: id,
    Etag: null,
    DateCreated: '2024-01-01T00:00:00.0000000Z',
    CanDelete: false,
    CanDownload: false,
    SortName: name.toLowerCase(),
    ExternalUrls: [],
    Path: `/${collectionType}`,
    EnableMediaSourceDisplay: true,
    Taglines: [],
    Genres: [],
    PlayAccess: 'Full',
    RemoteTrailers: [],
    ProviderIds: {},
    IsHD: null,
    IsFolder: true,
    ParentId: null,
    Type: 'CollectionFolder',
    People: [],
    Studios: [],
    GenreItems: [],
    Tags: [],
    PrimaryImageAspectRatio: null,
    ImageTags: {},
    BackdropImageTags: [],
    ScreenshotImageTags: [],
    ImageBlurHashes: {},
    CollectionType: collectionType,
    LocationType: 'FileSystem',
    MediaType: 'Unknown',
    LockedFields: [],
    ChildCount: childCount,
  };
}

export async function handleLibraries(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  switch (endpoint) {
    case 'UserViews': {
      const movieCount = await queries.getMovieCount(env.DB);
      const tvCount = await queries.getTVShowCount(env.DB);

      const items: Record<string, unknown>[] = [];

      if (movieCount > 0) {
        items.push(formatLibraryView('Movies', MOVIES_LIBRARY_ID, 'movies', movieCount));
      }

      if (tvCount > 0) {
        items.push(formatLibraryView('TV Shows', TV_LIBRARY_ID, 'tvshows', tvCount));
      }

      return jellyfinSuccess({
        Items: items,
        TotalRecordCount: items.length,
        StartIndex: 0,
      });
    }

    case 'MediaFolders': {
      const items = [
        formatLibraryView('Movies', MOVIES_LIBRARY_ID, 'movies', 0),
        formatLibraryView('TV Shows', TV_LIBRARY_ID, 'tvshows', 0),
      ];
      return jellyfinSuccess({
        Items: items,
        TotalRecordCount: items.length,
        StartIndex: 0,
      });
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}
