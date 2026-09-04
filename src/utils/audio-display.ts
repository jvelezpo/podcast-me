export function getEpisodeTitle(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getEpisodeInitials(filename: string): string {
  const words = getEpisodeTitle(filename).split(' ').filter(Boolean);

  if (words.length === 0) {
    return 'PM';
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function formatPlaybackTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function formatEpisodeDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);

  if (!Number.isFinite(date.getTime())) {
    return 'Recently added';
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return 'Saved offline';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function getArtworkColor(id: string): string {
  const colors = ['#5B5BD6', '#2870BD', '#147D6F', '#9A5B13', '#9C4A72', '#6E56CF'];
  const hash = Array.from(id).reduce((value, character) => value + character.charCodeAt(0), 0);

  return colors[hash % colors.length];
}
