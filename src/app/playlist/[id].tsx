import { useLocalSearchParams, useRouter } from 'expo-router'

import { PlaylistDetailContent } from '@/components/playlist-detail-content'

/** Deep-link route for a single playlist; the Playlists tab opens the same view as a modal. */
export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  return (
    <PlaylistDetailContent
      playlistId={id ?? ''}
      onClose={() => router.back()}
      onOpenLibrary={() => router.push('/')}
    />
  )
}
