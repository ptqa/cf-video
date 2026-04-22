import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

// Static library IDs
const MOVIES_LIBRARY_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const TV_LIBRARY_ID = 'a656b907eb3a73532e40e44b968d0225';

export async function handleLibraries(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  switch (endpoint) {
    case 'UserViews': {
      // Return virtual library views for the home screen
      const movieCount = await queries.getMovieCount(env.DB);
      const tvCount = await queries.getTVShowCount(env.DB);

      const items: Record<string, unknown>[] = [];

      if (movieCount > 0) {
        items.push({
          Name: 'Movies',
          ServerId: 'cf01de0000000000000000000000cafe',
          Id: MOVIES_LIBRARY_ID,
          Etag: '',
          DateCreated: '2024-01-01T00:00:00.0000000Z',
          CanDelete: false,
          CanDownload: false,
          SortName: 'movies',
          ExternalUrls: [],
          Path: '/movies',
          EnableMediaSourceDisplay: true,
          Taglines: [],
          Genres: [],
          PlayAccess: 'Full',
          RemoteTrailers: [],
          ProviderIds: {},
          IsFolder: true,
          ParentId: '',
          Type: 'CollectionFolder',
          People: [],
          Studios: [],
          GenreItems: [],
          TagItems: [],
          LockedFields: [],
          ImageTags: {},
          BackdropImageTags: [],
          ScreenshotImageTags: [],
          ImageBlurHashes: {},
          CollectionType: 'movies',
          LocationType: 'FileSystem',
          MediaType: 'Unknown',
          Tags: [],
          ChildCount: movieCount,
        });
      }

      if (tvCount > 0) {
        items.push({
          Name: 'TV Shows',
          ServerId: 'cf01de0000000000000000000000cafe',
          Id: TV_LIBRARY_ID,
          Etag: '',
          DateCreated: '2024-01-01T00:00:00.0000000Z',
          CanDelete: false,
          CanDownload: false,
          SortName: 'tv shows',
          ExternalUrls: [],
          Path: '/tv',
          EnableMediaSourceDisplay: true,
          Taglines: [],
          Genres: [],
          PlayAccess: 'Full',
          RemoteTrailers: [],
          ProviderIds: {},
          IsFolder: true,
          ParentId: '',
          Type: 'CollectionFolder',
          People: [],
          Studios: [],
          GenreItems: [],
          TagItems: [],
          LockedFields: [],
          ImageTags: {},
          BackdropImageTags: [],
          ScreenshotImageTags: [],
          ImageBlurHashes: {},
          CollectionType: 'tvshows',
          LocationType: 'FileSystem',
          MediaType: 'Unknown',
          Tags: [],
          ChildCount: tvCount,
        });
      }

      return jellyfinSuccess({
        Items: items,
        TotalRecordCount: items.length,
        StartIndex: 0,
      });
    }

    case 'MediaFolders': {
      return jellyfinSuccess({
        Items: [
          {
            Id: MOVIES_LIBRARY_ID,
            Name: 'Movies',
            CollectionType: 'movies',
          },
          {
            Id: TV_LIBRARY_ID,
            Name: 'TV Shows',
            CollectionType: 'tvshows',
          },
        ],
        TotalRecordCount: 2,
      });
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}
