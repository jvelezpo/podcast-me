import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createPlaylistId,
  normalizePlaylistDescription,
  normalizePlaylistName,
  playlistRefKey,
  type Playlist,
  type PlaylistAudioRef,
} from '@/models/playlist';
import {
  loadPlaylists,
  savePlaylists,
} from '@/services/playlist-storage';

export type PlaylistNotice = {
  kind: 'error' | 'warning';
  title: string;
  message: string;
};

const MAX_NAME_LENGTH = 80;

export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [notice, setNotice] = useState<PlaylistNotice | null>(null);
  const playlistsRef = useRef<Playlist[]>([]);
  const mutationInProgress = useRef(false);

  useEffect(() => {
    let isMounted = true;

    void loadPlaylists().then(({ playlists: loaded, error }) => {
      if (!isMounted) {
        return;
      }

      playlistsRef.current = loaded;
      setPlaylists(loaded);
      setIsLoading(false);

      if (error) {
        setNotice({
          kind: 'error',
          title: 'Playlists unavailable',
          message: error.message,
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const persist = useCallback(
    async (next: Playlist[], previous: Playlist[]): Promise<boolean> => {
      mutationInProgress.current = true;
      setIsMutating(true);
      playlistsRef.current = next;
      setPlaylists(next);

      try {
        await savePlaylists(next);
        return true;
      } catch {
        playlistsRef.current = previous;
        setPlaylists(previous);
        setNotice({
          kind: 'error',
          title: 'Playlist not saved',
          message: 'The previous playlists were restored. Try again.',
        });
        return false;
      } finally {
        mutationInProgress.current = false;
        setIsMutating(false);
      }
    },
    []
  );

  const createPlaylist = useCallback(
    async (name: string, description: string = ''): Promise<Playlist | null> => {
      if (mutationInProgress.current) {
        return null;
      }

      const normalizedName = normalizePlaylistName(name).slice(0, MAX_NAME_LENGTH);

      if (!normalizedName) {
        setNotice({
          kind: 'warning',
          title: 'Name required',
          message: 'Give your playlist a name to create it.',
        });
        return null;
      }

      const now = new Date().toISOString();
      const playlist: Playlist = {
        id: createPlaylistId(),
        name: normalizedName,
        description: normalizePlaylistDescription(description),
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      const previous = playlistsRef.current;
      const didSave = await persist([...previous, playlist], previous);

      if (didSave) {
        setNotice(null);
        return playlist;
      }

      return null;
    },
    [persist]
  );

  const renamePlaylist = useCallback(
    async (playlistId: string, name: string, description?: string): Promise<boolean> => {
      if (mutationInProgress.current) {
        return false;
      }

      const previous = playlistsRef.current;
      const current = previous.find((playlist) => playlist.id === playlistId);

      if (!current) {
        return false;
      }

      const normalizedName = normalizePlaylistName(name).slice(0, MAX_NAME_LENGTH);

      if (!normalizedName) {
        setNotice({
          kind: 'warning',
          title: 'Name required',
          message: 'Give your playlist a name to save it.',
        });
        return false;
      }

      const nextDescription =
        description === undefined ? current.description : normalizePlaylistDescription(description);

      if (current.name === normalizedName && current.description === nextDescription) {
        return true;
      }

      const next = previous.map((playlist) =>
        playlist.id === playlistId
          ? {
              ...playlist,
              name: normalizedName,
              description: nextDescription,
              updatedAt: new Date().toISOString(),
            }
          : playlist
      );

      setNotice(null);
      return persist(next, previous);
    },
    [persist]
  );

  const deletePlaylist = useCallback(
    async (playlistId: string): Promise<boolean> => {
      if (mutationInProgress.current) {
        return false;
      }

      const previous = playlistsRef.current;

      if (!previous.some((playlist) => playlist.id === playlistId)) {
        return false;
      }

      setNotice(null);
      return persist(
        previous.filter((playlist) => playlist.id !== playlistId),
        previous
      );
    },
    [persist]
  );

  const addToPlaylist = useCallback(
    async (playlistId: string, ref: PlaylistAudioRef): Promise<'added' | 'duplicate' | 'missing' | 'failed'> => {
      if (mutationInProgress.current) {
        return 'failed';
      }

      const previous = playlistsRef.current;
      const current = previous.find((playlist) => playlist.id === playlistId);

      if (!current) {
        return 'missing';
      }

      const key = playlistRefKey(ref);

      if (current.items.some((item) => playlistRefKey(item) === key)) {
        return 'duplicate';
      }

      const next = previous.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, items: [...playlist.items, ref], updatedAt: new Date().toISOString() }
          : playlist
      );

      const didSave = await persist(next, previous);
      return didSave ? 'added' : 'failed';
    },
    [persist]
  );

  const removeFromPlaylist = useCallback(
    async (playlistId: string, ref: PlaylistAudioRef): Promise<boolean> => {
      if (mutationInProgress.current) {
        return false;
      }

      const previous = playlistsRef.current;
      const current = previous.find((playlist) => playlist.id === playlistId);

      if (!current) {
        return false;
      }

      const key = playlistRefKey(ref);
      const nextItems = current.items.filter((item) => playlistRefKey(item) !== key);

      if (nextItems.length === current.items.length) {
        return false;
      }

      const next = previous.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, items: nextItems, updatedAt: new Date().toISOString() }
          : playlist
      );

      return persist(next, previous);
    },
    [persist]
  );

  const reorderPlaylistItem = useCallback(
    async (playlistId: string, ref: PlaylistAudioRef, offset: number): Promise<boolean> => {
      if (mutationInProgress.current || !Number.isInteger(offset) || offset === 0) {
        return false;
      }

      const previous = playlistsRef.current;
      const current = previous.find((playlist) => playlist.id === playlistId);

      if (!current) {
        return false;
      }

      const key = playlistRefKey(ref);
      const fromIndex = current.items.findIndex((item) => playlistRefKey(item) === key);

      if (fromIndex < 0) {
        return false;
      }

      const toIndex = Math.max(0, Math.min(fromIndex + offset, current.items.length - 1));

      if (toIndex === fromIndex) {
        return false;
      }

      const nextItems = [...current.items];
      const [moved] = nextItems.splice(fromIndex, 1);
      nextItems.splice(toIndex, 0, moved);
      const next = previous.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, items: nextItems, updatedAt: new Date().toISOString() }
          : playlist
      );

      return persist(next, previous);
    },
    [persist]
  );

  const movePlaylistItem = useCallback(
    async (playlistId: string, fromIndex: number, toIndex: number): Promise<boolean> => {
      if (
        mutationInProgress.current ||
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex)
      ) {
        return false;
      }

      const previous = playlistsRef.current;
      const current = previous.find((playlist) => playlist.id === playlistId);

      if (!current || fromIndex < 0 || fromIndex >= current.items.length) {
        return false;
      }

      const clampedTo = Math.max(0, Math.min(toIndex, current.items.length - 1));

      if (clampedTo === fromIndex) {
        return false;
      }

      const nextItems = [...current.items];
      const [moved] = nextItems.splice(fromIndex, 1);
      nextItems.splice(clampedTo, 0, moved);
      const next = previous.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, items: nextItems, updatedAt: new Date().toISOString() }
          : playlist
      );

      return persist(next, previous);
    },
    [persist]
  );

  /** Removes dangling references when a local audio file is deleted. */
  const pruneLocalAudio = useCallback(
    async (audioId: string): Promise<void> => {
      if (mutationInProgress.current) {
        return;
      }

      const previous = playlistsRef.current;
      const next = previous.map((playlist) => {
        const items = playlist.items.filter(
          (item) => !(item.kind === 'local' && item.audioId === audioId)
        );

        return items.length === playlist.items.length
          ? playlist
          : { ...playlist, items, updatedAt: new Date().toISOString() };
      });

      if (next.every((playlist, index) => playlist === previous[index])) {
        return;
      }

      await persist(next, previous);
    },
    [persist]
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return useMemo(
    () => ({
      playlists,
      isLoading,
      isMutating,
      notice,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      reorderPlaylistItem,
      movePlaylistItem,
      pruneLocalAudio,
      dismissNotice,
    }),
    [
      playlists,
      isLoading,
      isMutating,
      notice,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      reorderPlaylistItem,
      movePlaylistItem,
      pruneLocalAudio,
      dismissNotice,
    ],
  );
}
